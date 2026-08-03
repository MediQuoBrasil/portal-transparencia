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

        const data = await parseResponse(response);

        if (data.ok === false && data.code === 401) {
          window.Auth.logout();
          return { ok: false, error: 'Sessão expirada. Faça login novamente.', code: 401 };
        }

        return data;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        const isAbort = err.name === 'AbortError';
        lastError = isAbort
          ? 'O servidor demorou demais para responder.'
          : (err.message || 'Falha na comunicação.');

        console.error(`[API] Tentativa ${attempt + 1} falhou:`, lastError);

        if (attempt < MAX_RETRIES) {
          await wait(RETRY_DELAY * (attempt + 1));
        }
      }
    }

    return { ok: false, error: lastError };
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
        fetchFromNetwork(action, payload).then(async (networkResult) => {
          if (networkResult.ok) {
            await cache.set(action, payload, networkResult);
          }
        });

        return { ...cached.data, fromCache: true };
      }

      // Sem cache → buscar da rede e armazenar
      const networkResult = await fetchFromNetwork(action, payload);
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
   * Verifica se a resposta é JSON válido antes de parsear.
   * Quando o deploy do Apps Script está inválido, a URL do
   * redirect retorna HTML (404 do Google Drive) em vez de JSON.
   * Sem essa verificação, response.json() lança exceção
   * silenciosa e o login falha sem informação útil.
   *
   * @param {Response} response - Resposta do fetch.
   * @returns {Promise<ApiResult>}
   */
  const parseResponse = async (response) => {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
      console.error('[API] Resposta não-JSON. Content-Type:', contentType, 'Status:', response.status);
      return {
        ok: false,
        error: 'O servidor retornou uma resposta inválida. '
          + 'Verifique se a URL de deploy do Apps Script está atualizada.',
        code: response.status,
      };
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (_) {
      console.error('[API] Falha ao parsear JSON. Primeiros 200 chars:', text.slice(0, 200));
      return {
        ok: false,
        error: 'Resposta inválida do servidor. A URL de deploy pode estar desatualizada.',
      };
    }
  };

  /**
   * Envia requisição de login (sem token pré-existente).
   * Usa retry com backoff idêntico ao fetchFromNetwork para
   * resistir a cold-starts e falhas transitórias do Apps Script.
   *
   * @param {string} idToken - JWT do Google Identity Services.
   * @returns {Promise<ApiResult>}
   */
  const login = async (idToken) => {
    const body = JSON.stringify({ action: 'login', token: idToken });
    let lastError = 'Falha na comunicação com o servidor.';

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
          body,
          redirect: 'follow',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await parseResponse(response);

        // Resposta inválida (HTML 404 do Google Drive, etc.)
        // que indica deploy quebrado — não vale retry.
        if (!data.ok && data.code === 404) {
          return data;
        }

        return data;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        const isAbort = err.name === 'AbortError';
        lastError = isAbort
          ? 'O servidor demorou demais. Tente novamente.'
          : (err.message || 'Falha na comunicação com o servidor.');

        console.error(`[API] Login tentativa ${attempt + 1} falhou:`, lastError);

        if (attempt < MAX_RETRIES) {
          await wait(RETRY_DELAY * (attempt + 1));
        }
      }
    }

    return { ok: false, error: lastError };
  };

  window.Api = { request, login };
})();
