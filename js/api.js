/**
 * ═══════════════════════════════════════════════════════════
 *  api.js — Comunicação com o backend Apps Script
 * ═══════════════════════════════════════════════════════════
 *
 *  Integra cache via window.Cache (stale-while-revalidate):
 *  - Ações de leitura: tenta cache primeiro, rede como fallback.
 *  - Ações de escrita: rede direta + invalidação de cache.
 *
 *  Timeout: cada tentativa de fetch tem AbortController com
 *  25s de timeout, evitando pendurar indefinidamente quando o
 *  backend Apps Script está lento ou atingiu o limite de 30s.
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} ApiResult
   * @property {boolean} ok      - Indicador de sucesso
   * @property {*}       [data]  - Dados retornados
   * @property {string}  [error] - Mensagem de erro
   * @property {number}  [code]  - Código HTTP semântico
   * @property {boolean} [fromCache] - Se veio de cache
   */

  /**
   * Número máximo de retries para erros transitórios.
   * @type {number}
   */
  const MAX_RETRIES = 2;

  /**
   * Intervalo base entre retries (ms).
   * @type {number}
   */
  const RETRY_DELAY = 1500;

  /**
   * Timeout por tentativa de fetch (ms).
   * Apps Script: o ciclo completo é POST→302→GET redirect.
   * No cold-start cada passo soma latência:
   *   POST (1-6s) + 302 (0ms) + redirect follow (5-20s) = até 26s.
   * 45s evita cancelar requests que já consumiram ~20s de
   * processamento no backend, poupando retry desnecessário.
   * O backend Apps Script tem limite de 30s por execução; se
   * ultrapassar, retorna erro 500 naturalmente — não precisamos
   * cortar antes disso no client.
   * @type {number}
   */
  const FETCH_TIMEOUT = 45000;

  /**
   * Retries no login. 1 = no máximo 2 tentativas. Login é o gargalo do
   * 1º acesso: cada tentativa extra enfileira execução no backend
   * single-threaded, piorando o throttling. Em falha transitória real o
   * usuário reclica — aceitável frente a eliminar a cauda de 30–60 s.
   * @type {number}
   */
  const LOGIN_MAX_RETRIES = 1;

  /**
   * Timeout da 1ª tentativa de login (ms). Curto: falha rápido em
   * cold-start sem pendurar o usuário. O backend segue processando após o
   * abort (Apps Script não cancela no disconnect), então a 2ª tentativa
   * costuma achar o runtime já aquecendo.
   * @type {number}
   */
  const LOGIN_TIMEOUT_FIRST = 10000;

  /**
   * Timeout da 2ª tentativa de login (ms). Mais folgado: o cold-start já
   * passou; dá tempo de completar sem cortar cedo.
   * @type {number}
   */
  const LOGIN_TIMEOUT_RETRY = 20000;

  /**
   * Backoff entre tentativas de login (ms). Pequeno e fixo: backoff só
   * ajuda quando o backend NÃO está saturado — aqui, menos é mais.
   * @type {number}
   */
  const LOGIN_RETRY_DELAY = 800;

  /**
   * Pausa a execução por `ms` milissegundos.
   * @param {number} ms - Duração em milissegundos.
   * @returns {Promise<void>}
   */
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  /**
   * Registro de requisições em voo, para coalescência (single-flight).
   * Chave: action + payload normalizado. Valor: Promise em andamento.
   * @type {Map<string, Promise<ApiResult>>}
   */
  const inflight = new Map();

  /**
   * Compõe uma chave estável (chaves ordenadas) para identificar
   * requisições idênticas. Payloads com as mesmas entradas produzem
   * a mesma chave independente da ordem de inserção.
   *
   * @param {string} action - Nome da ação.
   * @param {Object} payload - Dados adicionais.
   * @returns {string} Chave de coalescência.
   * @private
   */
  const inflightKey_ = (action, payload) => {
    const p = payload || {};
    const norm = Object.keys(p)
      .sort()
      .map((k) => `${k}=${p[k]}`)
      .join('&');
    return `${action}?${norm}`;
  };

  /**
   * Retorna o token JWT da sessão atual.
   * @returns {string|null}
   */
  const getToken = () => {
    try {
      const raw = sessionStorage.getItem(window.AppConfig.SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      return session.token || null;
    } catch (_) {
      return null;
    }
  };

  /**
   * Faz o fetch bruto ao backend (sem cache).
   * Cada tentativa usa AbortController com timeout de 45s
   * (FETCH_TIMEOUT) para acomodar o ciclo POST→302→redirect
   * do Apps Script em cold-start.
   *
   * @param {string} action - Nome da ação.
   * @param {Object} [payload={}] - Dados adicionais.
   * @returns {Promise<ApiResult>}
   */
  const fetchFromNetwork = async (action, payload = {}) => {
    const token = getToken();
    const body = { action, token, ...payload };
    let lastError = 'Erro de conexão com o servidor.';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      /** @type {AbortController|null} */
      let controller = null;
      /** @type {number|null} */
      let timeoutId = null;

      try {
        controller = new AbortController();
        timeoutId = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT);

        const response = await fetch(window.AppConfig.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body),
          redirect: 'follow',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await parseResponse(response, action);

        if (data.ok === false && data.code === 401) {
          window.Auth.logout();
          return { ok: false, error: 'Sessão expirada. Faça login novamente.', code: 401 };
        }

        return data;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        const isAbort = err.name === 'AbortError';
        const isNetwork = err instanceof TypeError;
        lastError = isAbort
          ? 'O servidor demorou demais para responder.'
          : (err.message || 'Falha na comunicação.');

        console.error(`[API] Tentativa ${attempt + 1} (${action}) falhou:`, {
          error: lastError,
          type: err.name,
          isAbort,
          isNetwork,
          message: err.message,
        });

        if (attempt < MAX_RETRIES) {
          await wait(RETRY_DELAY * (attempt + 1));
        }
      }
    }

    return { ok: false, error: lastError };
  };

  /**
   * Coalescência de requisições (single-flight): requisições
   * idênticas concorrentes compartilham UMA chamada de rede em vez
   * de disparar N. Reduz a rajada de chamadas sobre o backend
   * Apps Script — cujas execuções concorrentes competem por recursos
   * e cujo endpoint de validação de token sofre throttling sob carga,
   * a causa raiz da lentidão observada.
   *
   * Aplicado apenas a leituras (idempotentes). Escritas nunca são
   * coalescidas — cada escrita é uma operação distinta.
   *
   * @param {string} action - Nome da ação.
   * @param {Object} payload - Dados adicionais.
   * @returns {Promise<ApiResult>}
   * @private
   */
  const fetchCoalesced_ = (action, payload) => {
    const key = inflightKey_(action, payload);
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = fetchFromNetwork(action, payload)
      .finally(() => { inflight.delete(key); });

    inflight.set(key, promise);
    return promise;
  };

  /**
   * Envia uma requisição autenticada ao backend.
   * Integra cache stale-while-revalidate para ações de leitura.
   *
   * @param {string} action - Nome da ação (rota do backend).
   * @param {Object} [payload={}] - Dados adicionais.
   * @returns {Promise<ApiResult>}
   */
  const request = async (action, payload = {}) => {
    const cache = window.Cache;

    // ── Ações de leitura: tentar cache primeiro ──
    if (cache && cache.isCacheable(action)) {
      const cached = await cache.get(action, payload);

      if (cached) {
        if (!cached.stale) {
          // Cache fresco → retorna direto
          return { ...cached.data, fromCache: true };
        }

        // Cache stale → retorna imediato E revalida em background
        fetchCoalesced_(action, payload).then(async (networkResult) => {
          if (networkResult.ok) {
            await cache.set(action, payload, networkResult);
          }
        });

        return { ...cached.data, fromCache: true };
      }

      // Sem cache → buscar da rede e armazenar
      const networkResult = await fetchCoalesced_(action, payload);
      if (networkResult.ok) {
        await cache.set(action, payload, networkResult);
      }
      return networkResult;
    }

    // ── Ações de escrita ou não cacheáveis: rede direta ──
    const result = await fetchFromNetwork(action, payload);

    // Invalidar cache de leitura associado após escrita bem-sucedida
    if (result.ok && cache) {
      await cache.invalidate(action);
    }

    return result;
  };

  /**
   * Parseia a resposta do fetch ao backend.
   *
   * Estratégia: sempre tenta parsear o body como JSON, independente
   * do Content-Type. O echo URL do Google Apps Script (destino do
   * redirect 302) nem sempre retorna o Content-Type correto —
   * pode vir text/html, text/javascript ou até vazio, mesmo quando
   * o body é JSON válido gerado por ContentService.setMimeType(JSON).
   * Bloquear o parse pelo Content-Type causa falsos positivos de
   * "deploy desatualizado" quando o backend respondeu corretamente.
   *
   * @param {Response} response - Resposta do fetch (pós-redirect).
   * @param {string}   [context='request'] - Contexto para logs.
   * @returns {Promise<ApiResult>}
   */
  const parseResponse = async (response, context = 'request') => {
    const contentType = response.headers.get('content-type') || '';
    const status = response.status;
    const finalUrl = response.url || '(indisponível)';
    const redirected = response.redirected || false;

    // ── Log de diagnóstico ──
    console.log(`[API][${context}] Resposta recebida:`, {
      status,
      contentType,
      redirected,
      finalUrl: finalUrl.slice(0, 120),
      type: response.type,
    });

    // ── Ler o body como texto (seguro para qualquer content-type) ──
    let text;
    try {
      text = await response.text();
    } catch (readErr) {
      console.error(`[API][${context}] Erro ao ler body:`, readErr.message);
      return {
        ok: false,
        error: 'Não foi possível ler a resposta do servidor.',
        code: status,
        _debug: { phase: 'body_read', readError: readErr.message },
      };
    }

    // ── Tentar parsear como JSON (independente do Content-Type) ──
    try {
      const parsed = JSON.parse(text);

      // Log se Content-Type estava "errado" mas JSON era válido
      if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
        console.warn(
          `[API][${context}] JSON válido apesar de Content-Type inesperado:`,
          contentType,
        );
      }

      return parsed;
    } catch (_) {
      // JSON inválido — agora sim é problema real
    }

    // ── Body não é JSON — diagnóstico detalhado ──
    const preview = text.slice(0, 300);
    const isHtml = contentType.includes('text/html') || text.trimStart().startsWith('<');
    const isGoogleError = text.includes('ServiceLogin') || text.includes('accounts.google.com');
    const is404Page = status === 404 || text.includes('404') || text.includes('not found');

    console.error(`[API][${context}] Resposta não-JSON.`, {
      status,
      contentType,
      isHtml,
      isGoogleError,
      is404Page,
      bodyPreview: preview,
      redirected,
      finalUrl: finalUrl.slice(0, 120),
    });

    // ── Classificação do erro ──
    if (isGoogleError) {
      return {
        ok: false,
        error: 'O Google exige reautorização do Apps Script. '
          + 'Abra o editor do script, execute qualquer função manualmente e re-autorize.',
        code: 403,
        _debug: { phase: 'google_auth_wall', status, contentType },
      };
    }

    if (is404Page) {
      return {
        ok: false,
        error: 'O servidor retornou página de erro (404). '
          + 'O deploy do Apps Script pode estar desatualizado.',
        code: 404,
        _debug: { phase: 'not_found', status, contentType },
      };
    }

    if (isHtml) {
      return {
        ok: false,
        error: `O servidor retornou HTML em vez de JSON (HTTP ${status}). `
          + 'Possível erro no deploy do Apps Script.',
        code: status,
        _debug: { phase: 'html_response', status, contentType, preview },
      };
    }

    return {
      ok: false,
      error: `Resposta inesperada do servidor (HTTP ${status}, tipo: ${contentType || 'vazio'}).`,
      code: status,
      _debug: { phase: 'unknown_format', status, contentType, preview },
    };
  };

  /**
   * Envia requisição de login (sem token pré-existente).
   *
   * Estratégia domada (T0‑C): no máximo LOGIN_MAX_RETRIES retry, timeout
   * progressivo (LOGIN_TIMEOUT_FIRST → LOGIN_TIMEOUT_RETRY) e backoff
   * curto (LOGIN_RETRY_DELAY). O `await` é sequencial: cada tentativa só
   * dispara depois que a anterior foi abortada e liquidada — nunca há dois
   * fetches de login em voo, evitando enfileirar execução redundante no
   * backend single-threaded.
   *
   * - 403 (auth wall do Google): não vale retry, exige ação manual.
   * - 5xx/404 (echo URL transitório): 1 retry, depois desiste.
   *
   * @param {string} idToken - JWT do Google Identity Services.
   * @returns {Promise<ApiResult>}
   */
  const login = async (idToken) => {
    const body = JSON.stringify({ action: 'login', token: idToken });
    let lastError = 'Falha na comunicação com o servidor.';
    /** @type {ApiResult|null} */
    let lastResult = null;

    console.log('[API][login] Iniciando login. URL:', window.AppConfig.API_URL.slice(0, 80));

    for (let attempt = 0; attempt <= LOGIN_MAX_RETRIES; attempt += 1) {
      // Timeout progressivo: 1ª curta (falha rápido em cold-start),
      // retry mais folgado (cold-start já passou).
      const timeout = attempt === 0 ? LOGIN_TIMEOUT_FIRST : LOGIN_TIMEOUT_RETRY;

      /** @type {AbortController|null} */
      let controller = null;
      /** @type {number|null} */
      let timeoutId = null;

      try {
        controller = new AbortController();
        // await sequencial: a tentativa anterior já foi abortada e
        // liquidada antes desta — nunca há dois fetches de login em voo.
        timeoutId = setTimeout(() => { controller.abort(); }, timeout);

        const t0 = Date.now();
        const response = await fetch(window.AppConfig.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body,
          redirect: 'follow',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const elapsed = Date.now() - t0;

        console.log(`[API][login] Fetch completou em ${elapsed}ms (timeout ${timeout}ms). ` +
          `Status: ${response.status}, Redirected: ${response.redirected}, ` +
          `URL final: ${(response.url || '').slice(0, 100)}`);

        const data = await parseResponse(response, 'login');

        // Auth wall do Google → não vale retry, exige ação manual
        if (!data.ok && data.code === 403 && data._debug?.phase === 'google_auth_wall') {
          return data;
        }

        // Resposta com sucesso ou erro de negócio (401 etc.) → retornar
        if (data.ok || (data.code && data.code < 500 && data.code !== 404)) {
          return data;
        }

        // Erros 5xx ou 404 (pode ser transitório no echo URL) → retry
        lastResult = data;
        lastError = data.error || lastError;

        console.warn(`[API][login] Tentativa ${attempt + 1}: erro potencialmente transitório.`, {
          code: data.code,
          phase: data._debug?.phase,
        });
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        const isAbort = err.name === 'AbortError';
        const isNetwork = err instanceof TypeError;
        lastError = isAbort
          ? 'O servidor demorou demais. Tente novamente.'
          : (err.message || 'Falha na comunicação com o servidor.');

        console.error(`[API][login] Tentativa ${attempt + 1} exceção:`, {
          error: lastError,
          type: err.name,
          isAbort,
          isNetwork,
        });
      }

      if (attempt < LOGIN_MAX_RETRIES) {
        console.log(`[API][login] Aguardando ${LOGIN_RETRY_DELAY}ms antes do retry...`);
        await wait(LOGIN_RETRY_DELAY);
      }
    }

    // Todas as tentativas falharam — retornar o resultado mais informativo
    return lastResult || { ok: false, error: lastError };
  };

  /**
   * Timeout da chamada check_update (ms). Curto: é uma rota pública
   * ultraleve que retorna apenas um timestamp. Em falha, o chamador
   * assume changed:true e faz o prefetch normal — nunca bloqueia a UI.
   * @type {number}
   */
  const CHECK_UPDATE_TIMEOUT = 8000;

  /**
   * Consulta a rota pública `check_update` (Fase A) para saber se houve
   * alguma escrita no servidor desde o último acesso do cliente.
   *
   * Fail-safe: qualquer falha (rede, timeout, deploy antigo sem a rota,
   * resposta inesperada) resolve como `{ changed: true }`, fazendo o
   * chamador refazer o prefetch — nunca serve cache desatualizado por
   * engano. Não usa retry nem token (rota pública, ultraleve).
   *
   * @param {number} since - Último `ultima_escrita` visto (epoch ms). 0 no 1º acesso.
   * @returns {Promise<{changed: boolean, ultima_escrita: number}>}
   */
  const checkUpdate = async (since) => {
    /** @type {AbortController|null} */
    let controller = null;
    /** @type {number|null} */
    let timeoutId = null;

    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => { controller.abort(); }, CHECK_UPDATE_TIMEOUT);

      const response = await fetch(window.AppConfig.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'check_update', since: Number(since) || 0 }),
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await parseResponse(response, 'check_update');

      // Rota indisponível (deploy antigo) ou resposta inesperada → fail-safe.
      if (!data || data.ok !== true || !data.data
        || typeof data.data.changed !== 'boolean') {
        return { changed: true, ultima_escrita: 0 };
      }

      return {
        changed: data.data.changed,
        ultima_escrita: Number(data.data.ultima_escrita) || 0,
      };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('[API][check_update] Falha — assumindo changed:true.', err.message);
      return { changed: true, ultima_escrita: 0 };
    }
  };

  /**
   * Dispara a carga única consolidada (rota autenticada `bootstrap`).
   *
   * Bypassa o cache de propósito: é a ÚNICA requisição de dados do
   * 1º acesso (ou de um acesso pós-escrita) e sua resposta é usada
   * para semear todas as chaves de leitura do IndexedDB. Não é
   * cacheada sob a própria ação `bootstrap`.
   *
   * @returns {Promise<ApiEnvelope>} Envelope `{ok, data}` do backend.
   *   Em falha de rede/deploy antigo, `fetchFromNetwork` já devolve
   *   `{ok:false, ...}` — o chamador cai para o fluxo legado.
   */
  const bootstrap = () => fetchFromNetwork('bootstrap', {});

  window.Api = { request, login, checkUpdate, bootstrap };
})();
