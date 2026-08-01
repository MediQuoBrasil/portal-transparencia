/**
 * ═══════════════════════════════════════════════════════════
 *  previsao.js — Previsão de custos futuros
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Tabela de projeção de teto para cada vigência de um ano
 *  - Total anual com soma dos tetos
 *  - Breakdown por dias úteis, feriados, horas
 *  - Seleção de ano via selector
 *  - Meses sem dados de relação exibem 0h / R$ 0,00
 *
 *  Dependências:
 *  - window.Api      (request)
 *  - window.UI       (showToast, showLoading, hideLoading)
 *  - window.Utils    (formatarMoeda, escapeHtml)
 *  - window.AppConfig (MESES)
 */

(function () {
  'use strict';

  // ─── Typedefs ──────────────────────────────────────────────

  /**
   * @typedef {Object} PrevisaoState
   * @property {number}   anoAtivo      - Ano selecionado
   * @property {number[]} anosDisponiveis - Anos do sistema
   * @property {Object|null} dados      - Dados de previsão do backend
   */

  /** @type {PrevisaoState} */
  const state = {
    anoAtivo: new Date().getFullYear(),
    anosDisponiveis: [],
    dados: null,
  };

  // ─── Render: Tela principal ─────────────────────────────

  /**
   * @param {number[]} anos
   */
  const render = (anos) => {
    state.anosDisponiveis = anos;

    const mainBody = document.getElementById('mainBody');
    if (!mainBody) return;

    const titleEl = document.getElementById('mainHeaderTitle');
    const subtitleEl = document.getElementById('mainHeaderSubtitle');
    if (titleEl) titleEl.textContent = 'Previsão de Custos';
    if (subtitleEl) subtitleEl.textContent = 'Projeção anual de teto por vigência';

    mainBody.innerHTML = renderShell();
    bindEvents();
    carregarPrevisao(state.anoAtivo);
  };

  /**
   * @returns {string}
   */
  const renderShell = () => {
    const options = state.anosDisponiveis
      .map((a) => `<option value="${a}"${a === state.anoAtivo ? ' selected' : ''}>${a}</option>`)
      .join('');

    return `
      <div class="prev-page">
        <div class="prev-toolbar">
          <div class="prev-toolbar-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span class="prev-toolbar-title">Projeção Anual</span>
          </div>
          <div class="prev-toolbar-right">
            <select class="prev-year-select" id="prevYearSelect">
              ${options}
            </select>
            <button type="button" class="btn btn--sm btn--ghost" id="prevRefreshBtn" title="Atualizar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round"
                   stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="prev-summary" id="prevSummary"></div>

        <div class="prev-table-wrap" id="prevTableWrap">
          <div class="prev-loading">
            <span class="spinner"></span> Calculando projeção...
          </div>
        </div>
      </div>
    `;
  };

  // ─── Render: Resumo anual ──────────────────────────────

  /**
   * @param {Object} dados
   * @returns {string}
   */
  const renderSummary = (dados) => {
    // Contar apenas meses com dados para a média
    const mesesComDados = dados.meses.filter((m) => m.tem_dados);
    const qtdMeses = mesesComDados.length || 1;
    const mediaMensal = dados.total_anual / qtdMeses;

    return `
      <div class="prev-summary-grid">
        <div class="prev-summary-card prev-summary-card--primary">
          <div class="prev-summary-label">Teto Anual Projetado</div>
          <div class="prev-summary-value">${window.Utils.formatarMoeda(dados.total_anual)}</div>
        </div>
        <div class="prev-summary-card">
          <div class="prev-summary-label">Total de Horas</div>
          <div class="prev-summary-value">${dados.total_horas.toLocaleString('pt-BR')}h</div>
        </div>
        <div class="prev-summary-card">
          <div class="prev-summary-label">Feriados no Ano</div>
          <div class="prev-summary-value">${dados.total_feriados}</div>
        </div>
        <div class="prev-summary-card">
          <div class="prev-summary-label">Média Mensal${qtdMeses < 12 ? ` (${qtdMeses} meses)` : ''}</div>
          <div class="prev-summary-value">${window.Utils.formatarMoeda(mediaMensal)}</div>
        </div>
      </div>
    `;
  };

  // ─── Render: Tabela de projeção ────────────────────────

  /**
   * @param {Object} dados
   * @returns {string}
   */
  const renderTable = (dados) => {
    const rows = dados.meses.map((m) => {
      const temDados = m.tem_dados;
      // 2026: processo iniciou em Jul — meses anteriores exibem zero explícito
      const zerarMes = dados.ano === 2026 && m.mes <= 6 && !temDados;
      const statusClass = m.status === 'ativa' ? 'prev-status--ativa' : '';
      const semDadosClass = !temDados ? 'prev-row--sem-dados' : '';

      let statusLabel;
      if (!temDados) {
        statusLabel = 'Sem dados';
      } else if (m.status === 'ativa') {
        statusLabel = 'Realizado';
      } else {
        statusLabel = 'Projetado';
      }

      const horasDisplay = temDados
        ? m.total_horas.toLocaleString('pt-BR') + 'h'
        : zerarMes ? '0h' : '—';
      const tetoDisplay = temDados
        ? window.Utils.formatarMoeda(m.teto_valor)
        : zerarMes ? window.Utils.formatarMoeda(0) : '—';

      return `
        <tr class="prev-row ${statusClass} ${semDadosClass}">
          <td class="prev-cell-mes">${window.Utils.escapeHtml(m.nome)}</td>
          <td class="prev-cell-periodo">${m.inicio.substring(0, 5)} — ${m.fim.substring(0, 5)}</td>
          <td class="num">${m.total_dias}</td>
          <td class="num">${m.dias_uteis}</td>
          <td class="num">${m.dias_feriado > 0 ? m.dias_feriado : '—'}</td>
          <td class="num">${horasDisplay}</td>
          <td class="num prev-cell-valor">${tetoDisplay}</td>
          <td>
            <span class="prev-status-badge ${statusClass} ${!temDados ? 'prev-status--sem-dados' : ''}">${statusLabel}</span>
          </td>
        </tr>
      `;
    }).join('');

    // Totais apenas de meses COM dados
    const totalDias = dados.meses.reduce((s, m) => s + m.total_dias, 0);
    const totalUteis = dados.meses.reduce((s, m) => s + m.dias_uteis, 0);

    return `
      <div class="card prev-card">
        <table class="prev-table">
          <thead>
            <tr>
              <th>Vigência</th>
              <th>Período</th>
              <th class="num">Dias</th>
              <th class="num">Úteis</th>
              <th class="num">Feriados</th>
              <th class="num">Horas</th>
              <th class="num">Teto</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr class="prev-row-total">
              <td colspan="2"><strong>Total ${dados.ano}</strong></td>
              <td class="num"><strong>${totalDias}</strong></td>
              <td class="num"><strong>${totalUteis}</strong></td>
              <td class="num"><strong>${dados.total_feriados || '—'}</strong></td>
              <td class="num"><strong>${dados.total_horas.toLocaleString('pt-BR')}h</strong></td>
              <td class="num prev-cell-valor"><strong>${window.Utils.formatarMoeda(dados.total_anual)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      ${renderComposicaoAnual(dados)}
    `;
  };

  // ─── Render: Composição anual de dias ──────────────────

  /**
   * @param {Object} dados
   * @returns {string}
   */
  const renderComposicaoAnual = (dados) => {
    const comp = dados.composicao_anual;
    const diasLabel = {
      segunda: 'Seg',
      'terça': 'Ter',
      quarta: 'Qua',
      quinta: 'Qui',
      sexta: 'Sex',
      'sábado': 'Sáb',
      domingo: 'Dom',
    };

    const totalDias = Object.values(comp).reduce((s, v) => s + v, 0);

    const items = Object.entries(diasLabel).map(([key, label]) => {
      const qtd = comp[key] || 0;
      const pct = totalDias > 0 ? Math.round((qtd / totalDias) * 100) : 0;
      return `
        <div class="prev-comp-item">
          <div class="prev-comp-bar" style="height: ${Math.max(pct, 4)}%"></div>
          <div class="prev-comp-label">${label}</div>
          <div class="prev-comp-value">${qtd}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="card prev-comp-card">
        <div class="prev-comp-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18"/>
            <path d="M9 21V9"/>
          </svg>
          <span>Composição de dias no ano — ${totalDias} dias totais</span>
        </div>
        <div class="prev-comp-chart">
          ${items}
        </div>
      </div>
    `;
  };

  // ─── Data fetching ─────────────────────────────────────

  /**
   * @param {number} ano
   * @returns {Promise<void>}
   */
  const carregarPrevisao = async (ano) => {
    const tableWrap = document.getElementById('prevTableWrap');
    const summaryEl = document.getElementById('prevSummary');

    if (tableWrap) {
      tableWrap.innerHTML = '<div class="prev-loading"><span class="spinner"></span> Calculando projeção...</div>';
    }
    if (summaryEl) {
      summaryEl.innerHTML = '';
    }

    const result = await window.Api.request('previsao_anual', { ano });

    if (!result.ok) {
      if (tableWrap) {
        tableWrap.innerHTML = `<div class="prev-error">${window.Utils.escapeHtml(result.error || 'Erro ao carregar previsão.')}</div>`;
      }
      return;
    }

    state.dados = result.data;

    if (summaryEl) {
      summaryEl.innerHTML = renderSummary(result.data);
    }
    if (tableWrap) {
      tableWrap.innerHTML = renderTable(result.data);
    }
  };

  // ─── Event bindings ────────────────────────────────────

  const bindEvents = () => {
    const yearSelect = document.getElementById('prevYearSelect');
    if (yearSelect) {
      yearSelect.addEventListener('change', (e) => {
        state.anoAtivo = Number(e.target.value);
        carregarPrevisao(state.anoAtivo);
      });
    }

    const refreshBtn = document.getElementById('prevRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        carregarPrevisao(state.anoAtivo);
      });
    }
  };

  // ─── Exports ───────────────────────────────────────────

  window.Previsao = { render };
})();
