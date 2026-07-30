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
    API_URL: 'https://script.google.com/macros/s/AKfycbxkF-3qQWNMaxnXRL-NIKGD6Puy9WsZCXT4ptzpGysQ1kTtsBSgErEufiJoVUmj_kLA2w/exec',

    // Substituir pelo Client ID real do projeto GCP
    GOOGLE_CLIENT_ID: '950451869210-qod9t7flim69ogffgcr9nn77hgtmsqvp.apps.googleusercontent.com',

    SESSION_KEY: 'mediquo_session',

    MESES: [
      'Janeiro', 'Fevereiro', 'Março', 'Abril',
      'Maio', 'Junho', 'Julho', 'Agosto',
      'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ],
  };

  window.AppConfig = CONFIG;
})();
