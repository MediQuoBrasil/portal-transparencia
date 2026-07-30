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
   * Converte duração em horas decimais.
   *
   * Aceita múltiplos formatos:
   * - String "HH:MM" (ex: "03:00" → 3)
   * - String Date serializada do Apps Script (ex: "Sun Dec 31 1899 03:00:00 GMT..." → 3)
   * - Número fracionário de dia (ex: 0.125 → 3)
   * - Número de horas direto (ex: 3 → 3)
   *
   * @param {string|number} dur - Duração em qualquer formato aceito.
   * @returns {number} Horas decimais.
   */
  const duracaoParaHorasDecimal = (dur) => {
    if (dur == null) return 0;

    // Número: fração de dia (< 1.5) ou horas diretas
    if (typeof dur === 'number') {
      return dur < 1.5 ? dur * 24 : dur;
    }

    const s = String(dur).trim();
    if (!s) return 0;

    // Formato padrão "HH:MM"
    if (/^\d{1,3}:\d{2}$/.test(s)) {
      const parts = s.split(':');
      return (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0) / 60;
    }

    // String Date do Apps Script ("Sun Dec 31 1899 03:00:00 GMT...")
    const timeMatch = s.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (timeMatch) {
      return (parseInt(timeMatch[1], 10) || 0) + (parseInt(timeMatch[2], 10) || 0) / 60;
    }

    // Fallback numérico
    const num = parseFloat(s);
    if (!Number.isNaN(num)) {
      return num < 1.5 ? num * 24 : num;
    }

    return 0;
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

  /**
   * Formata porcentagem para exibição.
   *
   * @param {number} parte - Valor parcial.
   * @param {number} total - Valor total.
   * @returns {string} Porcentagem formatada (ex: "12,5%"). Retorna "0%" se total ≤ 0.
   */
  const formatarPorcentagem = (parte, total) => {
    if (!total || total <= 0) return '0%';
    const pct = (parte / total) * 100;
    if (pct === 0) return '0%';
    if (Number.isInteger(pct)) return `${pct}%`;
    return `${pct.toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  };

  window.Utils = {
    formatarMoeda,
    formatarVigenciaCurta,
    duracaoParaHorasDecimal,
    formatarTotalHoras,
    formatarPorcentagem,
    extrairData,
    dataParaSort,
    escapeHtml,
  };
})();
