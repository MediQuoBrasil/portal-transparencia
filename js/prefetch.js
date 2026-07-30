/**
 * ═══════════════════════════════════════════════════════════
 *  prefetch.js — Prefetch inteligente em background
 * ═══════════════════════════════════════════════════════════
 *
 *  Estratégia de 3 camadas para eliminar espera percebida:
 *
 *  1. WARMUP ANTECIPADO (antes do login):
 *     Se existe sessão no sessionStorage, faz GET na URL da API
 *     para aquecer a instância do Apps Script (~1-2s cold-start)
 *     ANTES mesmo do Google Identity Services carregar.
 *
 *  2. PREFETCH DO ANO ATUAL (após render inicial):
 *     Chama batch_detalhes que retorna dados de 12 vigências + teto
 *     em UMA chamada (~1.5s). Armazena cada vigência individualmente
 *     no IndexedDB → acesso instantâneo ao trocar de mês.
 *
 *  3. PREFETCH DE ANOS ADJACENTES (idle time):
 *     Após o ano atual estar cacheado, prefetcha ano anterior/próximo
 *     usando requestIdleCallback para não afetar interatividade.
 *
 *  Dependências:
 *  - js_config.js  (AppConfig.API_URL)
 *  - js_cache.js   (window.Cache)
 *  - js_api.js     (window.Api)
 */

(function () {
  'use strict';

  // ─── Estado ──────────────────────────────────────────────────

  /**
   * @typedef {Object} PrefetchState
   * @property {boolean}    warmupFired   - Se warmup já foi disparado
   * @property {Set<number>} anosFetched  - Anos já prefetched
   * @property {boolean}    running       - Se há prefetch em andamento
   * @property {number[]}   queue         - Fila de anos para prefetch
   */

  /** @type {PrefetchState} */
  const state = {
    warmupFired: false,
    anosFetched: new Set(),
    running: false,
    queue: [],
  };

  // ─── 1. Warmup antecipado ───────────────────────────────────

  /**
   * Dispara GET na URL da API para aquecer o Apps Script.
   * Executado no boot se existe sessão — não precisa de auth.
   * Fire-and-forget: não bloqueia nada.
   */
  const earlyWarmup = () => {
    if (state.warmupFired) return;
    state.warmupFired = true;

    const apiUrl = window.AppConfig.API_URL;
    if (!apiUrl || apiUrl.includes('SEU_DEPLOY_ID')) return;

    // GET é público (doGet retorna status)
    // Apenas para aquecer — resultado descartado
    fetch(apiUrl, { method: 'GET', mode: 'cors' }).catch(() => {
      // Falha silenciosa — warmup é best-effort
    });
  };

  // ─── 2. Prefetch batch de vigências ─────────────────────────

  /**
   * Inicia prefetch em background do ano especificado.
   * Chama batch_detalhes no backend e armazena resultados
   * individuais no cache do frontend (IndexedDB).
   *
   * @param {number} ano - Ano a prefetchar.
   * @returns {Promise<boolean>} true se prefetch executou com sucesso.
   */
  const prefetchAno = async (ano) => {
    if (state.anosFetched.has(ano)) return true;

    try {
      const result = await window.Api.request('batch_detalhes', { ano });

      if (!result.ok || !result.data?.detalhes) return false;

      const { detalhes } = result.data;
      const cache = window.Cache;

      if (!cache) return false;

      // Armazenar cada vigência individualmente no cache frontend
      // Usa a mesma chave que detalhe_completo usaria
      const promises = Object.entries(detalhes).map(async ([mes, data]) => {
        const params = { ano, mes: Number(mes) };

        // Cache como detalhe_completo (para servir direto ao trocar vigência)
        await cache.set('detalhe_completo', params, { ok: true, data });

        // Cache separado detalhe e teto (para compatibilidade)
        if (data.detalhe) {
          await cache.set('detalhe_vigencia', params, { ok: true, data: data.detalhe });
        }
        if (data.teto) {
          await cache.set('teto_vigencia', params, { ok: true, data: data.teto });
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

  // ─── 3. Orquestrador de background ─────────────────────────

  /**
   * Inicia prefetch em background após render inicial.
   * Prioriza: ano ativo → ano anterior → ano seguinte.
   *
   * @param {number} anoAtivo - Ano atualmente selecionado.
   * @param {number[]} anosDisponiveis - Lista de todos os anos.
   */
  const startBackground = (anoAtivo, anosDisponiveis) => {
    if (state.running) return;
    state.running = true;

    // Montar fila de prioridade: ativo primeiro, depois adjacentes
    /** @type {number[]} */
    const fila = [anoAtivo];

    // Adjacentes em ordem de proximidade
    const sorted = [...anosDisponiveis].sort((a, b) => {
      const distA = Math.abs(a - anoAtivo);
      const distB = Math.abs(b - anoAtivo);
      return distA - distB;
    });

    sorted.forEach((a) => {
      if (!fila.includes(a)) fila.push(a);
    });

    state.queue = fila;

    // Processar fila com delay entre itens para não sobrecarregar
    processQueue_();
  };

  /**
   * Processa a fila de prefetch usando requestIdleCallback
   * ou setTimeout como fallback.
   *
   * @private
   */
  const processQueue_ = () => {
    if (state.queue.length === 0) {
      state.running = false;
      return;
    }

    const scheduleNext = (fn) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fn, { timeout: 5000 });
      } else {
        setTimeout(fn, 200);
      }
    };

    scheduleNext(async () => {
      const ano = state.queue.shift();
      if (ano && !state.anosFetched.has(ano)) {
        await prefetchAno(ano);
      }

      // Delay entre anos para não saturar o backend
      if (state.queue.length > 0) {
        setTimeout(processQueue_, 2000);
      } else {
        state.running = false;
      }
    });
  };

  // ─── 4. Cache-aware vigência loading ────────────────────────

  /**
   * Carrega dados completos (detalhe + teto) de uma vigência.
   * Tenta cache local primeiro → fallback para API.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   * @returns {Promise<{ok: boolean, data: Object|null, fromCache: boolean}>}
   */
  const loadVigencia = async (ano, mes) => {
    // 1. Tentar cache do detalhe_completo
    const cache = window.Cache;
    if (cache) {
      const cached = await cache.get('detalhe_completo', { ano, mes });
      if (cached && !cached.stale) {
        return { ok: true, data: cached.data.data || cached.data, fromCache: true };
      }
    }

    // 2. Chamar detalhe_completo (1 round-trip em vez de 2)
    const result = await window.Api.request('detalhe_completo', { ano, mes });

    return {
      ok: result.ok,
      data: result.ok ? result.data : null,
      fromCache: result.fromCache || false,
    };
  };

  /**
   * Retorna o estado do prefetch (para diagnóstico).
   *
   * @returns {PrefetchState}
   */
  const getState = () => ({
    warmupFired: state.warmupFired,
    anosFetched: [...state.anosFetched],
    running: state.running,
    queueLength: state.queue.length,
  });

  // ─── API pública ──────────────────────────────────────────────

  window.Prefetch = {
    earlyWarmup,
    startBackground,
    prefetchAno,
    loadVigencia,
    getState,
  };
})();
