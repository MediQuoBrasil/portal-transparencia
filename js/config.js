/**
 * ═══════════════════════════════════════════════════════════
 *  config.js — Constantes e configuração do frontend
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} AppConfig
   * @property {string} API_URL          - URL do Web App do Google Apps Script
   * @property {string} GOOGLE_CLIENT_ID - Client ID do projeto GCP
   * @property {string} SESSION_KEY      - Chave do sessionStorage para dados de sessão
   * @property {string[]} MESES          - Nomes dos meses em pt-BR
   */

  /** @type {AppConfig} */
  const CONFIG = {
    // Substituir pela URL real do deploy do Web App
    API_URL: 'https://script.google.com/macros/s/SEU_DEPLOY_ID/exec',

    // Substituir pelo Client ID real do projeto GCP
    GOOGLE_CLIENT_ID: 'SEU_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

    SESSION_KEY: 'mediquo_session',

    MESES: [
      'Janeiro', 'Fevereiro', 'Março', 'Abril',
      'Maio', 'Junho', 'Julho', 'Agosto',
      'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ],
  };

  window.AppConfig = CONFIG;
})();
