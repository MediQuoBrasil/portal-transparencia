/**
 * ═══════════════════════════════════════════════════════════
 *  api.js — Comunicação com o backend Apps Script
 * ═══════════════════════════════════════════════════════════
 *
 *  Integra cache via window.Cache (stale-while-revalidate):
 *  - Ações de leitura: tenta cache primeiro, rede como fallback.
 *  - Ações de escrita: rede direta + invalidação de cache.
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
      try {
        const response = await fetch(window.AppConfig.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body),
        });

        const data = await response.json();

        if (data.ok === false && data.code === 401) {
          window.Auth.logout();
          return { ok: false, error: 'Sessão expirada. Faça login novamente.', code: 401 };
        }

        return data;
      } catch (err) {
        lastError = err.message || 'Falha na comunicação.';
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
   * Envia requisição de login (sem token pré-existente).
   *
   * @param {string} idToken - JWT do Google Identity Services.
   * @returns {Promise<ApiResult>}
   */
  const login = async (idToken) => {
    try {
      const response = await fetch(window.AppConfig.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'login', token: idToken }),
      });

      return await response.json();
    } catch (err) {
      console.error('[API] Erro no login:', err.message);
      return { ok: false, error: 'Falha na comunicação com o servidor.' };
    }
  };

  window.Api = { request, login };
})();
