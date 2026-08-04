/**
 * ═══════════════════════════════════════════════════════════
 *  prefetch.js — Prefetch agressivo para carregamento
 *                instantâneo de vigências
 * ═══════════════════════════════════════════════════════════
 *
 *  Estratégia de 5 camadas para eliminar TODA espera percebida:
 *
 *  1. PREFETCH PRÉ-LOGIN LEVE (imediato, no carregamento do script):
 *     Chama endpoint público (sem auth) que retorna os dados do
 *     dashboard da vigência ativa: anos, vigências, detalhe, teto,
 *     relação de plantões e feriados. Armazena em IndexedDB.
 *
 *  2. PREFETCH PRÉ-LOGIN PESADO (APÓS o leve completar):
 *     Chama `prefetch_publico_ano` (sem auth) que retorna detalhe +
 *     teto de TODAS as 12 vigências do ano ativo. Popula o cache
 *     `detalhe_completo` de cada mês ANTES do login → navegação
 *     entre meses sem nenhum loading.
 *     ⚠ Dispara SOMENTE após o leve completar (ou falhar) — nunca
 *     em paralelo. Evita sobrecarregar o backend no cold-start.
 *
 *  3. SEED PÓS-RENDER (seedDashData):
 *     Os dados efetivamente renderizados no init (de qualquer fonte:
 *     memória, cache persistido ou rede) são re-persistidos nas
 *     chaves exatas lidas por loadVigencia. Garante hit de cache ao
 *     voltar para a vigência ativa.
 *
 *  4. SINGLE-FLIGHT POR ANO:
 *     Cliques em vigências cujo prefetch está em voo AGUARDAM a
 *     promise existente em vez de disparar rede duplicada.
 *
 *  5. PREFETCH DE ANOS ADJACENTES (pós-render):
 *     O ano ativo dispara imediatamente (sem idle callback); anos
 *     adjacentes seguem por proximidade com requestIdleCallback.
 *     Também aquece `listar_vigencias` de cada ano prefetched para
 *     que a troca de ano não exiba loading.
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
   * @property {boolean}      warmupFired         - Se warmup/prefetch já disparou
   * @property {Promise|null} preLoginPromise     - Promise do prefetch leve pré-login
   * @property {Promise|null} preLoginAnoPromise  - Promise do prefetch pesado (ano inteiro)
   * @property {boolean}      preLoginAnoSettled  - Se o prefetch pesado já concluiu
   * @property {Object|null}  preLoginData        - Dados retornados pelo prefetch público leve
   * @property {boolean}      preLoginDone        - Se prefetch leve pré-login completou
   * @property {boolean}      servedFromPersisted - Se o init renderizou a partir do cache persistido
   * @property {Function|null} freshResolve       - Resolver da promise de dados frescos
   * @property {Promise<Object|null>} freshPromise - Promise resolvida com dados frescos (ou null)
   * @property {Set<number>}  anosFetched         - Anos já prefetched (batch completo em cache)
   * @property {Map<number, Promise<boolean>>} anoPromises - Prefetch de ano em voo (single-flight)
   * @property {boolean}      running             - Se há prefetch de anos em andamento
   * @property {number[]}     queue               - Fila de anos para prefetch
   */

  /** @type {PrefetchState} */
  const state = {
    warmupFired: false,
    preLoginPromise: null,
    preLoginAnoPromise: null,
    preLoginAnoSettled: false,
    preLoginData: null,
    preLoginDone: false,
    servedFromPersisted: false,
    freshResolve: null,
    freshPromise: null,
    anosFetched: new Set(),
    anoPromises: new Map(),
    running: false,
    queue: [],
  };

  state.freshPromise = new Promise((resolve) => { state.freshResolve = resolve; });

  // Pre-login fetch desabilitado — o backend Apps Script é
  // single-threaded e chamadas pesadas pré-login (prefetch_publico
  // + prefetch_publico_ano) saturam a fila, fazendo o login
  // subsequente expirar por timeout. Resolver imediatamente
  // garante que whenFresh() não pendure como promise órfã.
  state.freshResolve(null);

  // ─── Constantes ────────────────────────────────────────────────

  /**
   * Timeout para aguardar o prefetch leve em getPreLoginData (ms).
   * Apps Script POST→302→redirect pode levar 6-20s (cold-start).
   * 10s cobre a maioria dos cenários quentes; no cold-start, o
   * fallback para init_dashboard (que também aguarda o backend)
   * assume sem perda adicional.
   * @type {number}
   */
  const PRE_LOGIN_TIMEOUT = 10000;

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * POST público (sem token) ao backend.
   * Sempre tenta parsear body como JSON independente do Content-Type,
   * pois o echo URL do Google Apps Script pode retornar Content-Type
   * incorreto (text/html, text/javascript) mesmo com body JSON válido.
   *
   * @param {Object} body - Corpo da requisição (inclui `action`).
   * @returns {Promise<Object>} Resposta JSON parseada.
   * @private
   */
  const postPublico_ = async (body) => {
    const controller = new AbortController();
    // Apps Script: POST→302→GET redirect chain pode levar 20-25s
    // em cold-start. 50s evita cancelar requests que estão prestes
    // a completar (o gargalo está no backend, não na rede).
    const timeoutId = setTimeout(() => { controller.abort(); }, 50000);

    try {
      const response = await fetch(window.AppConfig.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();

      // Sempre tentar JSON primeiro, independente de Content-Type
      try {
        return JSON.parse(text);
      } catch (_) {
        const contentType = response.headers.get('content-type') || '';
        console.warn('[Prefetch] Resposta não-JSON.', {
          status: response.status,
          contentType,
          redirected: response.redirected,
          bodyPreview: text.slice(0, 200),
        });
        return { ok: false, error: 'Resposta inválida do servidor' };
      }
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  /**
   * Persiste os detalhes de todas as vigências de um ano no cache
   * client-side, nas mesmas chaves lidas por loadVigencia.
   * Vigências passadas recebem TTL persistente (30d).
   *
   * @param {number} ano - Ano dos detalhes.
   * @param {Object<string|number, Object>} detalhes - Mapa mês → {detalhe, teto}.
   * @returns {Promise<void>}
   * @private
   */
  const storeAnoDetalhes_ = async (ano, detalhes) => {
    const cache = window.Cache;
    if (!cache || !detalhes) return;

    const ttlPersistente = cache.TTL?.PERSISTENTE;

    const promises = Object.entries(detalhes).map(async ([mes, data]) => {
      const mesNum = Number(mes);
      const params = { ano, mes: mesNum };
      const ttlOverride = cache.isVigenciaPassada(params)
        ? ttlPersistente
        : undefined;

      // Cache como detalhe_completo (chave primária do loadVigencia)
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

    // Cache do batch inteiro (espelha resposta de batch_detalhes)
    promises.push(cache.set('batch_detalhes', { ano }, {
      ok: true,
      data: { ano, detalhes },
    }));

    await Promise.all(promises);
    state.anosFetched.add(ano);
  };

  /**
   * Persiste os dados do dashboard (de qualquer fonte) nas chaves
   * que o fluxo de navegação consome. Chamado pelo prefetch leve
   * E pelo Vigencias.init() após renderizar — garante que a
   * vigência ativa esteja sempre em cache para loadVigencia.
   *
   * @param {Object} data - Dados no formato do init_dashboard/prefetch_publico.
   * @returns {Promise<void>}
   */
  const seedDashData = async (data) => {
    const cache = window.Cache;
    if (!cache || !data) return;

    const { ano, mes, detalhe, teto, feriados, relacao, vigencias } = data;

    /** @type {Promise<void>[]} */
    const tasks = [];

    // init_dashboard (chave padrão para o fluxo normal)
    tasks.push(cache.set('init_dashboard', {}, { ok: true, data }));

    // detalhe_completo da vigência ativa (chave lida por loadVigencia)
    if (detalhe && teto && ano && mes) {
      tasks.push(cache.set('detalhe_completo', { ano, mes }, {
        ok: true,
        data: { detalhe, teto },
      }));
    }

    // Relação de plantões — espelha handleObterRelacao
    if (relacao) {
      tasks.push(cache.set('obter_relacao', {}, {
        ok: true,
        data: { relacao: relacao.flat, agrupado: relacao.agrupado },
      }));
    }

    // Feriados do ano
    if (feriados && ano) {
      tasks.push(cache.set('listar_feriados', { ano }, {
        ok: true,
        data: { feriados },
      }));
    }

    // Lista real de vigências do ano — evita loading em selecionarAno
    if (Array.isArray(vigencias) && vigencias.length > 0 && ano) {
      tasks.push(cache.set('listar_vigencias', { ano }, {
        ok: true,
        data: { vigencias },
      }));
    }

    await Promise.all(tasks);
  };

  // ─── 1+2. Prefetch pré-login (público, sem auth) ─────────────

  /**
   * Dispara os prefetches públicos ao carregar o script:
   * - leve  (`prefetch_publico`): imediato, dashboard da vigência ativa;
   * - pesado (`prefetch_publico_ano`): APÓS o leve completar (ou falhar),
   *   todas as 12 vigências do ano. Nunca em paralelo — evita sobrecarregar
   *   o backend no cold-start.
   *
   * Fire-and-forget: não bloqueia nada. Resultados ficam disponíveis
   * via `getPreLoginData()` / cache IndexedDB para o Vigencias.init().
   */
  const earlyPreLoginFetch = () => {
    if (state.warmupFired) return;
    state.warmupFired = true;

    const apiUrl = window.AppConfig?.API_URL;
    if (!apiUrl || apiUrl.includes('SEU_DEPLOY_ID')) {
      state.freshResolve(null);
      return;
    }

    // ── Leve: dashboard da vigência ativa ──
    state.preLoginPromise = (async () => {
      try {
        const result = await postPublico_({ action: 'prefetch_publico' });

        if (!result.ok || !result.data) {
          state.freshResolve(null);
          return;
        }

        state.preLoginData = result.data;
        state.preLoginDone = true;

        // Se o init já renderizou a partir do cache persistido,
        // entregar os dados frescos para re-render silencioso.
        state.freshResolve(state.servedFromPersisted ? result.data : null);

        await seedDashData(result.data);
      } catch (_) {
        // Falha silenciosa — prefetch é best-effort.
        state.freshResolve(null);
      }
    })();

    // ── Pesado: todas as vigências do ano ativo ──
    // Dispara SOMENTE APÓS o leve completar (ou falhar).
    // Nunca em paralelo — no cold-start, duas requests pesadas
    // simultâneas sobrecarregam o backend Apps Script.
    state.preLoginAnoPromise = (async () => {
      // Aguardar o leve terminar (sucesso ou falha)
      try { await state.preLoginPromise; } catch (_) { /* ok */ }

      try {
        const result = await postPublico_({ action: 'prefetch_publico_ano' });

        if (!result.ok || !result.data?.detalhes) return false;

        const ano = Number(result.data.ano);
        if (!ano) return false;

        await storeAnoDetalhes_(ano, result.data.detalhes);
        return true;
      } catch (_) {
        return false;
      } finally {
        state.preLoginAnoSettled = true;
      }
    })();
  };

  /**
   * Retorna os dados do dashboard para o primeiro render.
   * Ordem: memória (fresco) → cache persistido (instantâneo, cobre
   * reload com sessão ativa) → aguardar prefetch leve em voo (COM TIMEOUT).
   *
   * Timeout: se o prefetch leve não completar em PRE_LOGIN_TIMEOUT ms,
   * retorna null para que o init faça fallback para init_dashboard.
   * Isso evita bloquear a UI quando o backend está frio.
   *
   * @returns {Promise<Object|null>} Dados do dashboard ou null.
   */
  const getPreLoginData = async () => {
    // 1. Fetch leve já completou → dados frescos em memória (0ms)
    if (state.preLoginDone && state.preLoginData) {
      return state.preLoginData;
    }

    // 2. Cache persistido → render instantâneo sem aguardar rede.
    //    O prefetch em voo entregará dados frescos via whenFresh().
    const cache = window.Cache;
    if (cache) {
      const cached = await cache.get('init_dashboard', {});
      const data = cached?.data?.data || null;
      if (data) {
        state.servedFromPersisted = true;
        return data;
      }
    }

    // 3. Sem cache → aguardar o fetch leve COM TIMEOUT
    //    Se o backend está frio, não bloquear a UI para sempre.
    if (state.preLoginPromise) {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => { resolve('__TIMEOUT__'); }, PRE_LOGIN_TIMEOUT);
      });

      const result = await Promise.race([
        state.preLoginPromise.then(() => 'done'),
        timeoutPromise,
      ]);

      if (result !== '__TIMEOUT__' && state.preLoginData) {
        return state.preLoginData;
      }

      // Timeout: prefetch leve demorou demais.
      // O init fará fallback para init_dashboard (autenticado).
      // O prefetch continuará em background e via whenFresh()
      // entregará dados frescos quando completar.
    }

    return null;
  };

  /**
   * Promise resolvida com dados frescos do dashboard quando o
   * prefetch leve completar APÓS um render a partir de cache
   * persistido — ou null quando não houver nada mais fresco.
   * Usada pelo Vigencias.init() para re-render silencioso.
   *
   * @returns {Promise<Object|null>}
   */
  const whenFresh = () => state.freshPromise;

  // ⚠ earlyPreLoginFetch() NÃO dispara mais no carregamento do script.
  // O backend Apps Script é single-threaded: as 2 chamadas pesadas
  // de prefetch público (prefetch_publico + prefetch_publico_ano)
  // saturavam a fila de execução, fazendo o login subsequente
  // expirar por timeout. O fluxo pós-login (Vigencias.init →
  // init_dashboard → startBackground) já cobre todo o carregamento
  // de dados sem concorrer com o login.

  // ─── Single-flight: aguardar prefetch em voo ─────────────────

  /**
   * Aguarda qualquer prefetch em voo que possa cobrir o ano
   * (público pesado pré-login ou batch autenticado), evitando
   * disparar rede duplicada para dados que já estão chegando.
   *
   * @param {number} ano - Ano desejado.
   * @returns {Promise<void>}
   * @private
   */
  const waitAnoPrefetch_ = async (ano) => {
    /** @type {Promise[]} */
    const pending = [];

    if (state.preLoginAnoPromise
      && !state.preLoginAnoSettled
      && !state.anosFetched.has(ano)) {
      pending.push(state.preLoginAnoPromise);
    }

    const inflight = state.anoPromises.get(ano);
    if (inflight) pending.push(inflight);

    if (pending.length > 0) {
      try {
        await Promise.all(pending);
      } catch (_) {
        // Prefetch é best-effort — fallback de rede assume adiante.
      }
    }
  };

  // ─── Prefetch batch de vigências (pós-login) ─────────────────

  /**
   * Prefetcha todas as vigências de um ano via batch_detalhes.
   * Requer auth (usa Api.request com token). Single-flight:
   * chamadas concorrentes para o mesmo ano compartilham a promise.
   *
   * @param {number} ano - Ano a prefetchar.
   * @returns {Promise<boolean>} true se sucesso.
   */
  const prefetchAno = (ano) => {
    if (state.anosFetched.has(ano)) return Promise.resolve(true);

    const inflight = state.anoPromises.get(ano);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const result = await window.Api.request('batch_detalhes', { ano });

        if (!result.ok || !result.data?.detalhes) return false;

        await storeAnoDetalhes_(ano, result.data.detalhes);

        // Aquecer listar_vigencias do ano em background:
        // Api.request cacheia sozinho → troca de ano sem loading.
        window.Api.request('listar_vigencias', { ano });

        // Aquecer também os datasets das abas de ANÁLISE (SOS e Previsão)
        // no IndexedDB. Sem isto, o 1º clique nessas abas é sempre cache
        // MISS → rede (allFresh não cria dado inexistente). Api.request
        // cacheia sozinho → em dia sem mudança, abrir SOS/Previsão serve
        // tudo do cache local, sem tocar o Apps Script.
        window.Api.request('batch_sos', { ano });
        window.Api.request('previsao_anual', { ano });

        return true;
      } catch (err) {
        console.warn('[Prefetch] Erro no prefetch do ano', ano, err);
        return false;
      } finally {
        state.anoPromises.delete(ano);
      }
    })();

    state.anoPromises.set(ano, promise);
    return promise;
  };

  // ─── Orquestrador de background ───────────────────────────

  /**
   * Delay entre prefetch de anos adjacentes (ms).
   * @type {number}
   */
  const INTER_YEAR_DELAY = 600;

  /**
   * Inicia prefetch em background após render inicial.
   * O ano ativo dispara IMEDIATAMENTE (sem idle callback);
   * adjacentes seguem por proximidade em idle time.
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
    processQueue_(true);
  };

  /**
   * Gate da Fase A: antes de disparar o prefetch pesado, consulta
   * `check_update`. Se nada mudou no servidor desde o último acesso,
   * o cache IndexedDB é usado intacto (nenhuma leitura de planilha) e o
   * prefetch é ignorado. Caso contrário (ou se não for possível
   * confirmar), roda o prefetch normal e atualiza o `since` local.
   *
   * Fire-and-forget: chamado após o primeiro render, não bloqueia a UI.
   *
   * @param {number} anoAtivo - Ano atualmente selecionado.
   * @param {number[]} anosDisponiveis - Lista de todos os anos.
   * @returns {Promise<void>}
   */
  const startBackgroundIfUnchanged = async (anoAtivo, anosDisponiveis) => {
    const cache = window.Cache;

    // Sem infra necessária (deploy antigo / cache indisponível) →
    // comportamento anterior: sempre prefetch.
    if (!cache || !cache.getSince || !cache.setAllFresh
      || !window.Api || !window.Api.checkUpdate) {
      startBackground(anoAtivo, anosDisponiveis);
      return;
    }

    /** @type {{changed: boolean, ultima_escrita: number}} */
    let result;
    try {
      const since = await cache.getSince();
      result = await window.Api.checkUpdate(since);
    } catch (_) {
      result = { changed: true, ultima_escrita: 0 };
    }

    if (result && result.changed === false) {
      // Nada mudou → servir tudo do IndexedDB, sem tocar o Apps Script.
      cache.setAllFresh(true);
      if (result.ultima_escrita > 0) cache.setSince(result.ultima_escrita);
      console.log('[Prefetch] check_update: sem mudanças — cache local intacto, prefetch pesado ignorado.');
      return;
    }

    // Houve escrita (ou não foi possível confirmar) → prefetch normal e
    // sincronizar o marcador local para o valor atual do servidor.
    cache.setAllFresh(false);
    if (result && result.ultima_escrita > 0) cache.setSince(result.ultima_escrita);
    startBackground(anoAtivo, anosDisponiveis);
  };

  /**
   * Processa a fila de prefetch. O primeiro item roda imediatamente
   * quando `immediate` é true; os demais via requestIdleCallback.
   *
   * @param {boolean} [immediate=false] - Executar sem aguardar idle.
   * @private
   */
  const processQueue_ = (immediate = false) => {
    if (state.queue.length === 0) {
      state.running = false;
      return;
    }

    const run = async () => {
      const ano = state.queue.shift();

      if (typeof ano === 'number') {
        // Se o prefetch público pesado ainda pode cobrir este ano,
        // aguardar antes de duplicar a chamada.
        await waitAnoPrefetch_(ano);

        if (!state.anosFetched.has(ano)) {
          await prefetchAno(ano);
        }
      }

      if (state.queue.length > 0) {
        setTimeout(() => { processQueue_(false); }, INTER_YEAR_DELAY);
      } else {
        state.running = false;
      }
    };

    if (immediate) {
      run();
      return;
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 100);
    }
  };

  // ─── Cache-aware vigência loading ─────────────────────────

  /**
   * Carrega dados completos (detalhe + teto) de uma vigência.
   * Waterfall: cache fresco → cache stale (retorno imediato com
   * revalidação em background via Api.request) → dados pré-login
   * em memória → aguardar prefetch em voo → rede.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   * @returns {Promise<{ok: boolean, data: Object|null, fromCache: boolean}>}
   */
  const loadVigencia = async (ano, mes) => {
    const cache = window.Cache;

    // 1. Cache local (fresco → retorno direto; stale → Api.request
    //    devolve o stale imediatamente e revalida em background)
    if (cache) {
      const cached = await cache.get('detalhe_completo', { ano, mes });

      if (cached && !cached.stale) {
        return {
          ok: true,
          data: cached.data.data || cached.data,
          fromCache: true,
        };
      }

      if (cached && cached.stale) {
        const result = await window.Api.request('detalhe_completo', { ano, mes });
        return {
          ok: result.ok,
          data: result.ok ? result.data : null,
          fromCache: result.fromCache || false,
        };
      }
    }

    // 2. Dados pré-login em memória cobrem exatamente este mês
    const pre = state.preLoginData;
    if (pre && Number(pre.ano) === ano && Number(pre.mes) === mes
      && pre.detalhe && pre.teto) {
      seedDashData(pre); // re-persistir em background
      return {
        ok: true,
        data: { detalhe: pre.detalhe, teto: pre.teto },
        fromCache: true,
      };
    }

    // 3. Prefetch em voo pode entregar este mês — aguardar em vez
    //    de disparar rede duplicada (single-flight)
    await waitAnoPrefetch_(ano);

    if (cache) {
      const cached = await cache.get('detalhe_completo', { ano, mes });
      if (cached) {
        return {
          ok: true,
          data: cached.data.data || cached.data,
          fromCache: true,
        };
      }
    }

    // 4. Fallback: detalhe_completo (1 round-trip)
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
    preLoginAnoSettled: state.preLoginAnoSettled,
    hasPreLoginData: state.preLoginData !== null,
    servedFromPersisted: state.servedFromPersisted,
    anosFetched: [...state.anosFetched],
    anosInFlight: [...state.anoPromises.keys()],
    running: state.running,
    queueLength: state.queue.length,
  });

  // ─── API pública ─────────────────────────────────────────────

  /**
   * Invalida estado em memória do prefetch após uma operação de
   * escrita (upload, remoção). Limpa:
   * - preLoginData (pode conter temDados stale)
   * - anosFetched (forçar re-prefetch do ano)
   * - anoPromises em voo
   *
   * Não toca no IndexedDB/localStorage — isso é feito por
   * Cache.invalidate() chamado em Api.request().
   *
   * @param {number} [ano] - Ano afetado (limpa do anosFetched).
   */
  const invalidateForUpload = (ano) => {
    state.preLoginData = null;
    state.preLoginDone = false;

    if (ano) {
      state.anosFetched.delete(ano);
    } else {
      state.anosFetched.clear();
    }
  };

  window.Prefetch = {
    /** @deprecated Mantido por compatibilidade — earlyPreLoginFetch substitui */
    earlyWarmup: earlyPreLoginFetch,
    startBackground,
    startBackgroundIfUnchanged,
    prefetchAno,
    loadVigencia,
    getPreLoginData,
    seedDashData,
    whenFresh,
    getState,
    invalidateForUpload,
  };
})();
