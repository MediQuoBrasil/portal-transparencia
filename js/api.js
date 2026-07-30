/**
 * ═══════════════════════════════════════════════════════════
 *  api.js — Comunicação com o backend Apps Script
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} ApiResult
   * @property {boolean} ok      - Indicador de sucesso
   * @property {*}       [data]  - Dados retornados
   * @property {string}  [error] - Mensagem de erro
   * @property {number}  [code]  - Código HTTP semântico
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
   * Determina se um código HTTP é transitório (retry-able).
   * @param {number} status - Código HTTP.
   * @returns {boolean}
   */
  const isTransient = (status) => status === 0 || status >= 500 || status === 429;

  /**
   * Envia uma requisição POST autenticada ao backend.
   *
   * @param {string} action - Nome da ação (rota do backend).
   * @param {Object} [payload={}] - Dados adicionais.
   * @returns {Promise<ApiResult>}
   */
  const request = async (action, payload = {}) => {
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

        // Apps Script web apps retornam sempre 200 (mesmo erros lógicos).
        // O JSON interno tem o campo "ok" para indicar sucesso/falha.
        const data = await response.json();

        // Se o backend retornou, não é erro transitório — parar.
        if (data.ok === false && data.code === 401) {
          // Sessão expirada → forçar logout
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
