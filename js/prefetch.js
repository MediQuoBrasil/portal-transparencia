/**
 * ═══════════════════════════════════════════════════════════
 *  prefetch.js — Prefetch agressivo para carregamento
 *                instantâneo de vigências
 * ═══════════════════════════════════════════════════════════
 *
 *  Estratégia de 4 camadas para eliminar TODA espera percebida:
 *
 *  1. PREFETCH PRÉ-LOGIN (imediato, no carregamento do script):
 *     Chama endpoint público (sem auth) que retorna todos os
 *     dados do dashboard: anos, vigências, detalhe, teto,
 *     relação de plantões e feriados. Armazena em IndexedDB.
 *     Quando o login completar, dados já estão no cache →
 *     renderização instantânea sem loading.
 *
 *  2. WARMUP SIMULTÂNEO:
 *     O prefetch pré-login já aquece o Apps Script (elimina
 *     cold-start) como efeito colateral.
 *
 *  3. PREFETCH DE VIGÊNCIAS ADJACENTES (após render):
 *     Chama batch_detalhes para o ano inteiro, populando
 *     o cache de todas as 12 vigências. Navegação entre
 *     meses fica instantânea.
 *
 *  4. PREFETCH DE ANOS ADJACENTES (idle time):
 *     Após o ano ativo, prefetcha anos anteriores/seguintes
 *     com requestIdleCallback.
 *
 *  Dependências:
 *  - js_config.js  (AppConfig.API_URL)
 *  - js_cache.js   (window.Cache) — deve carregar ANTES
 */

(function () {
  'use strict';

  // ─── Estado ──────────────────────────────────────────────────

  /**
   * @typedef {Object} PrefetchState
   * @property {boolean}     warmupFired     - Se warmup/prefetch já disparou
   * @property {Promise|null} preLoginPromise - Promise do prefetch pré-login
   * @property {Object|null}  preLoginData    - Dados retornados pelo prefetch público
   * @property {boolean}      preLoginDone    - Se prefetch pré-login completou
   * @property {Set<number>}  anosFetched     - Anos já prefetched via batch
   * @property {boolean}      running         - Se há prefetch de anos em andamento
   * @property {number[]}     queue           - Fila de anos para prefetch
   */

  /** @type {PrefetchState} */
  const state = {
    warmupFired: false,
    preLoginPromise: null,
    preLoginData: null,
    preLoginDone: false,
    anosFetched: new Set(),
    running: false,
    queue: [],
  };

  // ─── 1. Prefetch pré-login (público, sem auth) ───────────────

  /**
   * Dispara o prefetch público IMEDIATAMENTE ao carregar o script.
   * Chama o endpoint `prefetch_publico` (sem token de auth).
   * Armazena resposta em memória E no IndexedDB para persistência.
   *
   * Fire-and-forget: não bloqueia nada. O resultado fica
   * disponível via `getPreLoginData()` para o Vigencias.init()
   * consumir após login.
   */
  const earlyPreLoginFetch = () => {
    if (state.warmupFired) return;
    state.warmupFired = true;

    const apiUrl = window.AppConfig?.API_URL;
    if (!apiUrl || apiUrl.includes('SEU_DEPLOY_ID')) return;

    state.preLoginPromise = (async () => {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'prefetch_publico' }),
        });

        const result = await response.json();

        if (!result.ok || !result.data) {
          // Fallback: pelo menos aquecer o backend
          return;
        }

        state.preLoginData = result.data;
        state.preLoginDone = true;

        // Armazenar no IndexedDB para persistência entre reloads
        await storePreLoginInCache_(result.data);
      } catch (_) {
        // Falha silenciosa — prefetch é best-effort.
        // Na pior hipótese, o fluxo normal (init_dashboard) assume.
      }
    })();
  };

  /**
   * Armazena os dados do prefetch pré-login no cache (IndexedDB).
   * Popula as mesmas chaves que o fluxo normal usaria,
   * para que `Cache.get('init_dashboard', ...)` encontre os dados.
   *
   * @param {Object} data - Dados retornados pelo prefetch_publico.
   * @returns {Promise<void>}
   * @private
   */
  const storePreLoginInCache_ = async (data) => {
    const cache = window.Cache;
    if (!cache) return;

    const { ano, mes, detalhe, teto, feriados, relacao } = data;

    // Armazenar como init_dashboard (chave padrão para o fluxo normal)
    await cache.set('init_dashboard', {}, {
      ok: true,
      data,
    });

    // Armazenar detalhe_completo individual (para loadVigencia)
    if (detalhe && teto) {
      const params = { ano, mes };
      await cache.set('detalhe_completo', params, {
        ok: true,
        data: { detalhe, teto },
      });
    }

    // Armazenar relação de plantões
    // Formato deve espelhar handleObterRelacao: { relacao: [...], agrupado: {...} }
    // O consumidor (renderRelacaoEditor) lê relResult.data.relacao
    if (relacao) {
      await cache.set('obter_relacao', {}, {
        ok: true,
        data: { relacao: relacao.flat, agrupado: relacao.agrupado },
      });
    }

    // Armazenar feriados
    if (feriados && ano) {
      await cache.set('listar_feriados', { ano }, {
        ok: true,
        data: { feriados },
      });
    }
  };

  /**
   * Retorna os dados do prefetch pré-login, se disponíveis.
   * Aguarda a conclusão se ainda estiver em andamento.
   *
   * @returns {Promise<Object|null>} Dados do dashboard ou null.
   */
  const getPreLoginData = async () => {
    // Se já completou, retornar direto (0ms)
    if (state.preLoginDone && state.preLoginData) {
      return state.preLoginData;
    }

    // Se ainda em andamento, aguardar (milissegundos no máximo)
    if (state.preLoginPromise) {
      await state.preLoginPromise;
      return state.preLoginData;
    }

    // Se não disparou (URL não configurada), tentar cache persistido
    const cache = window.Cache;
    if (cache) {
      const cached = await cache.get('init_dashboard', {});
      if (cached && !cached.stale) {
        return cached.data?.data || null;
      }
    }

    return null;
  };

  // Disparar IMEDIATAMENTE ao carregar o script
  earlyPreLoginFetch();

  // ─── 2. Prefetch batch de vigências (pós-login) ──────────────

  /**
   * Prefetcha todas as vigências de um ano via batch_detalhes.
   * Requer auth (usa Api.request com token).
   *
   * @param {number} ano - Ano a prefetchar.
   * @returns {Promise<boolean>} true se sucesso.
   */
  const prefetchAno = async (ano) => {
    if (state.anosFetched.has(ano)) return true;

    try {
      const result = await window.Api.request('batch_detalhes', { ano });

      if (!result.ok || !result.data?.detalhes) return false;

      const { detalhes } = result.data;
      const cache = window.Cache;

      if (!cache) return false;

      const ttlPersistente = cache.TTL?.PERSISTENTE;

      const promises = Object.entries(detalhes).map(async ([mes, data]) => {
        const mesNum = Number(mes);
        const params = { ano, mes: mesNum };
        const ttlOverride = cache.isVigenciaPassada(params)
          ? ttlPersistente
          : undefined;

        // Cache como detalhe_completo
        await cache.set('detalhe_completo', params, {
          ok: true,
          data,
        }, ttlOverride);

        // Cache separado para compatibilidade
        if (data.detalhe) {
          await cache.set('detalhe_vigencia', params, {
            ok: true,
            data: data.detalhe,
          }, ttlOverride);
        }
        if (data.teto) {
          await cache.set('teto_vigencia', params, {
            ok: true,
            data: data.teto,
          }, ttlOverride);
        }
      });

      await Promise.all(promises);

      state.anosFetched.add(ano);
      return true;
    } catch (err) {
      console.warn('[Prefetch] Erro no prefetch do ano', ano, err);
      return false;
    }
  };

  // ─── 3. Orquestrador de background ───────────────────────────

  /**
   * Delay entre prefetch de anos adjacentes (ms).
   * @type {number}
   */
  const INTER_YEAR_DELAY = 600;

  /**
   * Inicia prefetch em background após render inicial.
   * Prioriza: ano ativo → adjacentes por proximidade.
   *
   * @param {number} anoAtivo - Ano atualmente selecionado.
   * @param {number[]} anosDisponiveis - Lista de todos os anos.
   */
  const startBackground = (anoAtivo, anosDisponiveis) => {
    if (state.running) return;
    state.running = true;

    /** @type {number[]} */
    const fila = [anoAtivo];

    const sorted = [...anosDisponiveis].sort((a, b) => {
      const distA = Math.abs(a - anoAtivo);
      const distB = Math.abs(b - anoAtivo);
      return distA - distB;
    });

    sorted.forEach((a) => {
      if (!fila.includes(a)) fila.push(a);
    });

    state.queue = fila;
    processQueue_();
  };

  /**
   * Processa a fila de prefetch usando requestIdleCallback.
   * @private
   */
  const processQueue_ = () => {
    if (state.queue.length === 0) {
      state.running = false;
      return;
    }

    const scheduleNext = (fn) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fn, { timeout: 3000 });
      } else {
        setTimeout(fn, 100);
      }
    };

    scheduleNext(async () => {
      const ano = state.queue.shift();
      if (ano && !state.anosFetched.has(ano)) {
        await prefetchAno(ano);
      }

      if (state.queue.length > 0) {
        setTimeout(processQueue_, INTER_YEAR_DELAY);
      } else {
        state.running = false;
      }
    });
  };

  // ─── 4. Cache-aware vigência loading ─────────────────────────

  /**
   * Carrega dados completos (detalhe + teto) de uma vigência.
   * Tenta cache local primeiro → fallback para API.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   * @returns {Promise<{ok: boolean, data: Object|null, fromCache: boolean}>}
   */
  const loadVigencia = async (ano, mes) => {
    const cache = window.Cache;

    // 1. Tentar cache do detalhe_completo
    if (cache) {
      const cached = await cache.get('detalhe_completo', { ano, mes });
      if (cached && !cached.stale) {
        return {
          ok: true,
          data: cached.data.data || cached.data,
          fromCache: true,
        };
      }
    }

    // 2. Chamar detalhe_completo (1 round-trip)
    const result = await window.Api.request('detalhe_completo', { ano, mes });

    return {
      ok: result.ok,
      data: result.ok ? result.data : null,
      fromCache: result.fromCache || false,
    };
  };

  /**
   * Retorna o estado do prefetch (diagnóstico / debug).
   *
   * @returns {Object}
   */
  const getState = () => ({
    warmupFired: state.warmupFired,
    preLoginDone: state.preLoginDone,
    hasPreLoginData: state.preLoginData !== null,
    anosFetched: [...state.anosFetched],
    running: state.running,
    queueLength: state.queue.length,
  });

  // ─── API pública ─────────────────────────────────────────────

  window.Prefetch = {
    /** @deprecated Mantido por compatibilidade — earlyPreLoginFetch substitui */
    earlyWarmup: earlyPreLoginFetch,
    startBackground,
    prefetchAno,
    loadVigencia,
    getPreLoginData,
    getState,
  };
})();
