/**
 * ═══════════════════════════════════════════════════════════
 *  prefetch.js — Prefetch inteligente em background
 * ═══════════════════════════════════════════════════════════
 *
 *  Estratégia de 3 camadas para eliminar espera percebida:
 *
 *  1. WARMUP INCONDICIONAL (no carregamento do script):
 *     Dispara GET na URL da API IMEDIATAMENTE ao carregar,
 *     ANTES do GIS, ANTES do login. Aquece o Apps Script (~1-2s)
 *     enquanto o usuário interage com a tela de login.
 *
 *  2. PREFETCH DO ANO ATUAL (após render inicial):
 *     Chama batch_detalhes que retorna dados de 12 vigências + teto
 *     em UMA chamada (~1.5s). Armazena cada vigência individualmente
 *     no IndexedDB com TTL inteligente:
 *     - Vigências passadas: 30 dias (dados imutáveis)
 *     - Vigência atual/futura: 2h (pode mudar)
 *
 *  3. PREFETCH DE ANOS ADJACENTES (idle time):
 *     Após o ano atual estar cacheado, prefetcha ano anterior/próximo
 *     usando requestIdleCallback (delay 600ms entre anos).
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
   * Fire-and-forget: não bloqueia nada.
   *
   * Disparado INCONDICIONALMENTE no carregamento do script,
   * ANTES do GIS e ANTES do login. Economia: elimina ~1-2s de
   * cold-start do caminho crítico do primeiro init_dashboard.
   */
  const earlyWarmup = () => {
    if (state.warmupFired) return;
    state.warmupFired = true;

    const apiUrl = window.AppConfig?.API_URL;
    if (!apiUrl || apiUrl.includes('SEU_DEPLOY_ID')) return;

    // GET é público (doGet retorna status)
    // Apenas para aquecer — resultado descartado
    fetch(apiUrl, { method: 'GET', mode: 'cors' }).catch(() => {
      // Falha silenciosa — warmup é best-effort
    });
  };

  // Disparar warmup imediatamente ao carregar o script (antes de tudo)
  earlyWarmup();

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
      // Usa a mesma chave que detalhe_completo usaria.
      // Vigências passadas recebem TTL de 30 dias (dados imutáveis).
      const ttlPersistente = cache.TTL?.PERSISTENTE;

      const promises = Object.entries(detalhes).map(async ([mes, data]) => {
        const mesNum = Number(mes);
        const params = { ano, mes: mesNum };
        const ttlOverride = cache.isVigenciaPassada(params) ? ttlPersistente : undefined;

        // Cache como detalhe_completo (para servir direto ao trocar vigência)
        await cache.set('detalhe_completo', params, { ok: true, data }, ttlOverride);

        // Cache separado detalhe e teto (para compatibilidade)
        if (data.detalhe) {
          await cache.set('detalhe_vigencia', params, { ok: true, data: data.detalhe }, ttlOverride);
        }
        if (data.teto) {
          await cache.set('teto_vigencia', params, { ok: true, data: data.teto }, ttlOverride);
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
   * Delay entre prefetch de anos adjacentes (ms).
   * 600ms: suficiente para não saturar o backend Apps Script,
   * mas ~70% mais rápido que o anterior (2000ms).
   * @type {number}
   */
  const INTER_YEAR_DELAY = 600;

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
