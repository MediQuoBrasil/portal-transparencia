/**
 * ═══════════════════════════════════════════════════════════
 *  utils.js — Utilitários compartilhados
 * ═══════════════════════════════════════════════════════════
 *
 *  Funções de formatação, conversão e manipulação de dados
 *  usadas pelos módulos de vigências e relatórios.
 */

(function () {
  'use strict';

  /**
   * Formata valor numérico para moeda brasileira.
   *
   * @param {number} valor - Valor numérico.
   * @returns {string} Valor formatado (ex: "R$ 1.234,00").
   */
  const formatarMoeda = (valor) => `R$ ${Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  /**
   * Formata string de vigência "DD/MM/AAAA~DD/MM/AAAA" para "DD-MM a DD-MM".
   *
   * @param {string} vigStr - String no formato "DD/MM/AAAA~DD/MM/AAAA".
   * @returns {string} Formato curto (ex: "21-06 a 20-07").
   */
  const formatarVigenciaCurta = (vigStr) => {
    const partes = vigStr.split('~');
    if (partes.length !== 2) return vigStr;
    const ini = partes[0].trim();
    const fim = partes[1].trim();
    const iniCurto = ini.substring(0, 5).replace(/\//g, '-');
    const fimCurto = fim.substring(0, 5).replace(/\//g, '-');
    return `${iniCurto} a ${fimCurto}`;
  };

  /**
   * Converte duração "HH:MM" em horas decimais.
   *
   * @param {string} dur - Duração no formato "HH:MM".
   * @returns {number} Horas decimais (ex: "03:00" → 3, "01:30" → 1.5).
   */
  const duracaoParaHorasDecimal = (dur) => {
    if (!dur || typeof dur !== 'string') return 0;
    const parts = dur.split(':');
    if (parts.length !== 2) return 0;
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h + m / 60;
  };

  /**
   * Formata total de horas para exibição em pt-BR.
   *
   * @param {number} horas - Total de horas decimais.
   * @returns {string} Formatado (ex: "120 horas" ou "120,5 horas").
   */
  const formatarTotalHoras = (horas) => {
    if (Number.isInteger(horas)) {
      return `${horas} horas`;
    }
    return `${horas.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })} horas`;
  };

  /**
   * Extrai apenas a data "DD/MM/AAAA" de uma string "DD/MM/AAAA HH:MM".
   *
   * @param {string} dataHora - Data e hora no formato "DD/MM/AAAA HH:MM".
   * @returns {string} Apenas a data "DD/MM/AAAA".
   */
  const extrairData = (dataHora) => (dataHora ? dataHora.substring(0, 10) : '');

  /**
   * Converte "DD/MM/AAAA" para objeto Date sortável.
   *
   * @param {string} dataStr - Data no formato "DD/MM/AAAA".
   * @returns {Date} Objeto Date correspondente.
   */
  const dataParaSort = (dataStr) => {
    const p = dataStr.split('/');
    return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
  };

  /**
   * Escapa HTML para prevenir XSS em inserções no DOM.
   *
   * @param {string} str - String a escapar.
   * @returns {string} String com caracteres HTML escapados.
   */
  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  window.Utils = {
    formatarMoeda,
    formatarVigenciaCurta,
    duracaoParaHorasDecimal,
    formatarTotalHoras,
    extrairData,
    dataParaSort,
    escapeHtml,
  };
})();
