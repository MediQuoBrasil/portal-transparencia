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
   * Formata string de vigência "DD/MM/AAAA~DD/MM/AAAA" para "DD/MM a DD/MM".
   *
   * @param {string} vigStr - String no formato "DD/MM/AAAA~DD/MM/AAAA".
   * @returns {string} Formato curto (ex: "21/06 a 20/07").
   */
  const formatarVigenciaCurta = (vigStr) => {
    const partes = vigStr.split('~');
    if (partes.length !== 2) return vigStr;
    const ini = partes[0].trim();
    const fim = partes[1].trim();
    return `${ini.substring(0, 5)} a ${fim.substring(0, 5)}`;
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

  /**
   * Distribui porcentagens usando o método do maior resto (largest remainder),
   * garantindo que a soma seja exatamente 100% com 1 casa decimal.
   *
   * @param {number[]} valores - Valores parciais de cada item.
   * @param {number}   total   - Soma de todos os valores.
   * @returns {string[]} Porcentagens formatadas (ex: ["14,4%", "12,7%", …]).
   */
  const distribuirPorcentagens = (valores, total) => {
    if (!total || total <= 0) return valores.map(() => '0%');

    // Calcular porcentagens brutas com 1 casa decimal (×10 para trabalhar com inteiros)
    const raw = valores.map((v) => (v / total) * 1000); // ×1000 = 1 casa decimal em ×10
    const floored = raw.map((r) => Math.floor(r));
    const remainders = raw.map((r, i) => ({ i, rem: r - floored[i] }));

    // Diferença a distribuir (em unidades de 0,1%)
    let diff = 1000 - floored.reduce((s, v) => s + v, 0);

    // Distribuir ao maior resto
    remainders.sort((a, b) => b.rem - a.rem);
    for (let k = 0; k < diff && k < remainders.length; k += 1) {
      floored[remainders[k].i] += 1;
    }

    // Formatar cada valor
    return floored.map((f) => {
      const intPart = Math.floor(f / 10);
      const decPart = f % 10;
      if (decPart === 0) return `${intPart}%`;
      return `${intPart},${decPart}%`;
    });
  };

  /**
   * Mapeamento de meses abreviados em inglês para número (01–12).
   * @type {Object<string, string>}
   */
  const MESES_EN = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  /**
   * Normaliza uma string de data/hora para o formato "DD/MM/AAAA HH:MM".
   *
   * Aceita:
   * - Já no formato correto: "21/06/2026 19:00" → retorna como está.
   * - Date.toString() do JS: "Sun Jun 21 2026 19:00:00 GMT-0300 (…)" → converte.
   * - ISO 8601: "2026-06-21T19:00:00" → converte.
   *
   * @param {string|Date} val - Data em qualquer formato aceito.
   * @returns {string} Data no formato "DD/MM/AAAA HH:MM", ou string original se não reconhecida.
   */
  const normalizarDataHora = (val) => {
    if (val == null) return '';
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(val.getDate())}/${pad(val.getMonth() + 1)}/${val.getFullYear()} `
        + `${pad(val.getHours())}:${pad(val.getMinutes())}`;
    }

    const s = String(val).trim();
    if (!s) return '';

    // Já no formato correto "DD/MM/AAAA HH:MM"
    if (/^\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/.test(s)) return s;

    // Date.toString(): "Wed Jun 24 2026 09:00:00 GMT-0300 (…)"
    const jsMatch = s.match(/^\w{3}\s(\w{3})\s(\d{1,2})\s(\d{4})\s(\d{2}):(\d{2})/);
    if (jsMatch) {
      const mes = MESES_EN[jsMatch[1]] || '01';
      const dia = jsMatch[2].padStart(2, '0');
      return `${dia}/${mes}/${jsMatch[3]} ${jsMatch[4]}:${jsMatch[5]}`;
    }

    // ISO 8601: "2026-06-24T09:00:00…"
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]} ${isoMatch[4]}:${isoMatch[5]}`;
    }

    return s;
  };

  window.Utils = {
    formatarMoeda,
    formatarVigenciaCurta,
    duracaoParaHorasDecimal,
    formatarTotalHoras,
    formatarPorcentagem,
    distribuirPorcentagens,
    normalizarDataHora,
    extrairData,
    dataParaSort,
    escapeHtml,
  };
})();
