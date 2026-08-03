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
   * Usa retry com backoff para resistir a cold-starts e falhas
   * transitórias do Apps Script.
   *
   * Diferenças em relação ao fetchFromNetwork:
   * - Retry em TODO erro não-permanente (inclusive 404 transitório
   *   do echo URL do Google, que pode ser infraestrutura e não deploy).
   * - Só aborta retry cedo se o body for uma página de auth Google
   *   (code 403), que exige ação manual e não resolve com retry.
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      /** @type {AbortController|null} */
      let controller = null;
      /** @type {number|null} */
      let timeoutId = null;

      try {
        controller = new AbortController();
        timeoutId = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT);

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

        console.log(`[API][login] Fetch completou em ${elapsed}ms. ` +
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

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY * (attempt + 1);
        console.log(`[API][login] Aguardando ${delay}ms antes do retry...`);
        await wait(delay);
      }
    }

    // Todas as tentativas falharam — retornar o resultado mais informativo
    return lastResult || { ok: false, error: lastError };
  };

  window.Api = { request, login };
})();
