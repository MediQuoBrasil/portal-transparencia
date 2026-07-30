/**
 * ═══════════════════════════════════════════════════════════
 *  teto.js — Relação de plantões e cálculo de teto
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Exibição do teto por vigência (integrado ao detalhe)
 *  - Interface de edição da relação de plantões (admin)
 *  - Exibição do detalhamento diário do teto
 *  - Comparação teto × realizado
 */

(function () {
  'use strict';

  // ─── Typedefs ──────────────────────────────────────────────

  /**
   * @typedef {Object} PlantaoEntry
   * @property {string} dia_semana  - Dia da semana
   * @property {string} plantao     - Nome do plantão
   * @property {string} periodo     - Período (ex: "07h a 13h")
   * @property {number} total_horas - Horas do plantão
   */

  /**
   * @typedef {Object} TetoData
   * @property {Object}   teto             - Dados do teto calculado
   * @property {number}   valor_realizado  - Valor efetivamente realizado
   * @property {number}   horas_realizadas - Horas efetivamente realizadas
   * @property {number}   diferenca        - Diferença teto - realizado
   * @property {number}   percentual       - % realizado sobre teto
   * @property {boolean}  usou_snapshot    - Se usou snapshot ou relação atual
   */

  /**
   * @typedef {Object} TetoState
   * @property {PlantaoEntry[]} relacaoAtual - Relação de plantões atual
   * @property {boolean}        editando     - Se está editando a relação
   */

  /** @type {TetoState} */
  const state = {
    relacaoAtual: [],
    editando: false,
  };

  // ─── Constantes ────────────────────────────────────────────

  /** @type {string[]} */
  const DIAS_LABEL = [
    'Segunda', 'Terça', 'Quarta',
    'Quinta', 'Sexta', 'Sábado', 'Domingo',
  ];

  /** @type {string[]} */
  const DIAS_KEY = [
    'segunda', 'terça', 'quarta',
    'quinta', 'sexta', 'sábado', 'domingo',
  ];

  // ─── Teto da vigência (embutido no detalhe) ────────────────

  /**
   * Carrega e renderiza o bloco de teto dentro do detalhe da vigência.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   * @returns {Promise<void>}
   */
  const carregarTetoVigencia = async (ano, mes) => {
    const container = document.getElementById('tetoContainer');
    if (!container) return;

    container.innerHTML = '<div class="teto-loading"><span class="spinner"></span> Calculando teto...</div>';

    const result = await window.Api.request('teto_vigencia', { ano, mes });

    if (!result.ok) {
      container.innerHTML = `<div class="teto-error">${window.Utils.escapeHtml(result.error || 'Erro ao calcular teto.')}</div>`;
      return;
    }

    container.innerHTML = renderTetoCard(result.data);
    bindTetoToggle();
  };

  /**
   * Renderiza o card de teto com métricas e detalhamento.
   *
   * @param {TetoData} data - Dados do teto.
   * @returns {string} HTML.
   */
  const renderTetoCard = (data) => {
    const { teto, valor_realizado, diferenca, percentual, usou_snapshot } = data;
    const { total_horas, total_valor, qtd_feriados, composicao, dias } = teto;

    const diferencaClass = diferenca >= 0 ? 'positive' : 'negative';
    const diferencaIcon = diferenca >= 0
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    // Barra de progresso visual
    const pctClamped = Math.min(percentual, 100);
    const barColor = percentual > 100 ? 'var(--danger)' : 'var(--accent)';

    // Composição de dias
    const compHtml = composicao
      ? Object.entries(composicao)
        .filter(([, v]) => v > 0)
        .map(([dia, qtd]) => `<span class="teto-comp-item">${qtd}× ${dia}</span>`)
        .join('')
      : '';

    return `
      <div class="teto-card">
        <div class="teto-header">
          <div class="teto-header-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <span class="teto-header-title">Teto da vigência</span>
          </div>
          ${usou_snapshot ? '<span class="teto-badge teto-badge--snapshot">Snapshot</span>' : '<span class="teto-badge teto-badge--current">Relação atual</span>'}
        </div>

        <div class="teto-metrics">
          <div class="teto-metric teto-metric--primary">
            <div class="teto-metric-label">Teto</div>
            <div class="teto-metric-value">${window.Utils.formatarMoeda(total_valor)}</div>
          </div>
          <div class="teto-metric">
            <div class="teto-metric-label">Realizado</div>
            <div class="teto-metric-value">${window.Utils.formatarMoeda(valor_realizado)}</div>
          </div>
          <div class="teto-metric teto-metric--${diferencaClass}">
            <div class="teto-metric-label">Diferença</div>
            <div class="teto-metric-value">
              ${diferencaIcon}
              ${window.Utils.formatarMoeda(Math.abs(diferenca))}
            </div>
          </div>
        </div>

        <div class="teto-progress">
          <div class="teto-progress-bar">
            <div class="teto-progress-fill" style="width: ${pctClamped}%; background: ${barColor}"></div>
          </div>
          <div class="teto-progress-label">${percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% utilizado</div>
        </div>

        <div class="teto-details-row">
          <span class="teto-detail">${total_horas.toLocaleString('pt-BR')}h planejadas</span>
          <span class="teto-detail-sep">·</span>
          <span class="teto-detail">${dias ? dias.length : 0} dias</span>
          <span class="teto-detail-sep">·</span>
          <span class="teto-detail">${qtd_feriados} feriado${qtd_feriados !== 1 ? 's' : ''}</span>
        </div>

        ${compHtml ? `<div class="teto-composicao">${compHtml}</div>` : ''}

        <button type="button" class="teto-toggle-detail" id="tetoToggleDetail">
          <span>Ver detalhamento diário</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" class="teto-chevron">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div class="teto-detail-table-wrap" id="tetoDetailWrap">
          ${renderTetoDetailTable(dias)}
        </div>
      </div>
    `;
  };

  /**
   * Renderiza a tabela de detalhamento diário do teto.
   *
   * @param {Object[]} dias - Dias do teto.
   * @returns {string} HTML.
   */
  const renderTetoDetailTable = (dias) => {
    if (!dias || dias.length === 0) return '';

    const rowsHtml = dias.map((d) => {
      const fmtData = d.data.split('-').reverse().join('/');
      const feriClass = d.eh_feriado ? ' teto-row--feriado' : '';
      return `
        <tr class="teto-detail-row${feriClass}">
          <td>${fmtData}</td>
          <td>${d.dia_semana}</td>
          <td class="num">${d.horas}h</td>
          <td class="num">${window.Utils.formatarMoeda(d.valor_dia)}</td>
          <td>${d.eh_feriado ? '<span class="teto-feriado-dot"></span>' : ''}</td>
        </tr>
      `;
    }).join('');

    return `
      <table class="teto-detail-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Dia</th>
            <th class="num">Horas</th>
            <th class="num">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  };

  /**
   * Vincula o toggle do detalhamento do teto.
   */
  const bindTetoToggle = () => {
    const btn = document.getElementById('tetoToggleDetail');
    const wrap = document.getElementById('tetoDetailWrap');
    if (!btn || !wrap) return;

    btn.addEventListener('click', () => {
      const isOpen = wrap.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
    });
  };

  // ─── Edição da Relação de Plantões ────────────────────────

  /**
   * Renderiza a interface de edição da relação de plantões.
   *
   * @param {HTMLElement} container - Container alvo.
   */
  const renderRelacaoEditor = async (container) => {
    container.innerHTML = '<div class="teto-loading"><span class="spinner"></span> Carregando relação de plantões...</div>';

    const result = await window.Api.request('obter_relacao');

    if (!result.ok) {
      container.innerHTML = `
        <div class="card">
          <div class="teto-error">${window.Utils.escapeHtml(result.error || 'Erro ao carregar relação.')}</div>
        </div>
      `;
      return;
    }

    state.relacaoAtual = result.data.relacao || [];

    container.innerHTML = renderRelacaoView();
    bindRelacaoEvents();
  };

  /**
   * Renderiza a visão da relação de plantões (modo visualização/edição).
   *
   * @returns {string} HTML.
   */
  const renderRelacaoView = () => {
    const session = window.Auth.getSession();
    const isAdmin = session?.role === 'admin';

    // Agrupar por dia
    /** @type {Object<string, PlantaoEntry[]>} */
    const byDay = {};
    DIAS_KEY.forEach((d) => { byDay[d] = []; });

    state.relacaoAtual.forEach((r) => {
      const dia = r.dia_semana.toLowerCase();
      // Normalizar 'terca' → 'terça' etc.
      const normalizedKey = DIAS_KEY.find((k) => dia === k || dia.replace(/[çã]/g, (c) => ({ ç: 'c', ã: 'a' }[c])) === k.replace(/[çã]/g, (c) => ({ ç: 'c', ã: 'a' }[c])));
      if (normalizedKey && byDay[normalizedKey]) {
        byDay[normalizedKey].push(r);
      }
    });

    const daysHtml = DIAS_KEY.map((dia, idx) => {
      const entries = byDay[dia] || [];
      const plantoes = entries.filter((e) => e.plantao.toUpperCase() !== 'TOTAL');
      const totalEntry = entries.find((e) => e.plantao.toUpperCase() === 'TOTAL');
      const totalHoras = totalEntry ? totalEntry.total_horas : plantoes.reduce((s, p) => s + p.total_horas, 0);

      const rowsHtml = plantoes.map((p, pIdx) => `
        <tr class="relacao-row" data-dia="${dia}" data-idx="${pIdx}">
          <td>${state.editando
    ? `<input type="text" class="relacao-input" value="${window.Utils.escapeHtml(p.plantao)}" data-field="plantao">`
    : window.Utils.escapeHtml(p.plantao)}</td>
          <td>${state.editando
    ? `<input type="text" class="relacao-input relacao-input--sm" value="${window.Utils.escapeHtml(p.periodo)}" data-field="periodo">`
    : window.Utils.escapeHtml(p.periodo)}</td>
          <td class="num">${state.editando
    ? `<input type="number" class="relacao-input relacao-input--xs" value="${p.total_horas}" min="0" max="24" step="1" data-field="total_horas">`
    : `${p.total_horas}h`}</td>
          ${state.editando ? `<td><button type="button" class="relacao-remove-btn" data-dia="${dia}" data-idx="${pIdx}" title="Remover">×</button></td>` : ''}
        </tr>
      `).join('');

      return `
        <div class="relacao-day-block">
          <div class="relacao-day-header">
            <span class="relacao-day-name">${DIAS_LABEL[idx]}</span>
            <span class="relacao-day-total">${totalHoras}h</span>
          </div>
          <table class="relacao-table">
            <thead>
              <tr>
                <th>Plantão</th>
                <th>Período</th>
                <th class="num">Horas</th>
                ${state.editando ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="3" class="relacao-empty">Nenhum plantão cadastrado</td></tr>'}
            </tbody>
          </table>
          ${state.editando ? `
            <button type="button" class="relacao-add-btn" data-dia="${dia}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar plantão
            </button>
          ` : ''}
        </div>
      `;
    }).join('');

    const totalGeral = DIAS_KEY.reduce((sum, dia) => {
      const entries = byDay[dia] || [];
      const totalEntry = entries.find((e) => e.plantao.toUpperCase() === 'TOTAL');
      return sum + (totalEntry ? totalEntry.total_horas : entries.reduce((s, p) => s + p.total_horas, 0));
    }, 0);

    return `
      <div class="card relacao-card">
        <div class="relacao-card-header">
          <div class="relacao-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Relação de Plantões
          </div>
          <div class="relacao-card-meta">
            <span class="relacao-total-badge">${totalGeral}h semanais</span>
            ${isAdmin ? `
              ${state.editando
    ? `
                <button type="button" class="btn btn--sm btn--ghost" id="relacaoCancelar">Cancelar</button>
                <button type="button" class="btn btn--sm btn--accent" id="relacaoSalvar">Salvar</button>
              `
    : `
                <button type="button" class="btn btn--sm btn--ghost" id="relacaoEditar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              `
}
            ` : ''}
          </div>
        </div>

        <div class="relacao-grid">${daysHtml}</div>
      </div>
    `;
  };

  /**
   * Vincula eventos da interface de relação de plantões.
   */
  const bindRelacaoEvents = () => {
    const editarBtn = document.getElementById('relacaoEditar');
    const salvarBtn = document.getElementById('relacaoSalvar');
    const cancelarBtn = document.getElementById('relacaoCancelar');

    if (editarBtn) {
      editarBtn.addEventListener('click', () => {
        state.editando = true;
        const container = document.getElementById('relacaoContainer');
        if (container) {
          container.innerHTML = renderRelacaoView();
          bindRelacaoEvents();
        }
      });
    }

    if (cancelarBtn) {
      cancelarBtn.addEventListener('click', () => {
        state.editando = false;
        const container = document.getElementById('relacaoContainer');
        if (container) {
          renderRelacaoEditor(container);
        }
      });
    }

    if (salvarBtn) {
      salvarBtn.addEventListener('click', salvarRelacao);
    }

    // Add buttons
    document.querySelectorAll('.relacao-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dia = btn.dataset.dia;
        adicionarPlantao(dia);
      });
    });

    // Remove buttons
    document.querySelectorAll('.relacao-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { dia, idx } = btn.dataset;
        removerPlantao(dia, parseInt(idx, 10));
      });
    });
  };

  /**
   * Adiciona uma linha de plantão em branco para um dia.
   *
   * @param {string} dia - Dia da semana (chave).
   */
  const adicionarPlantao = (dia) => {
    state.relacaoAtual.push({
      dia_semana: dia,
      plantao: '',
      periodo: '',
      total_horas: 0,
    });

    const container = document.getElementById('relacaoContainer');
    if (container) {
      container.innerHTML = renderRelacaoView();
      bindRelacaoEvents();
    }
  };

  /**
   * Remove um plantão específico.
   *
   * @param {string} dia - Dia da semana.
   * @param {number} idx - Índice no array filtrado por dia.
   */
  const removerPlantao = (dia, idx) => {
    // Encontrar o n-ésimo registro desse dia (excluindo TOTAL)
    let count = 0;
    for (let i = 0; i < state.relacaoAtual.length; i += 1) {
      const r = state.relacaoAtual[i];
      const rDia = r.dia_semana.toLowerCase();
      const isMatch = rDia === dia || rDia.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === dia.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      if (isMatch && r.plantao.toUpperCase() !== 'TOTAL') {
        if (count === idx) {
          state.relacaoAtual.splice(i, 1);
          break;
        }
        count += 1;
      }
    }

    const container = document.getElementById('relacaoContainer');
    if (container) {
      container.innerHTML = renderRelacaoView();
      bindRelacaoEvents();
    }
  };

  /**
   * Coleta os dados editados e salva no backend.
   */
  const salvarRelacao = async () => {
    // Coletar valores dos inputs
    /** @type {PlantaoEntry[]} */
    const novaRelacao = [];

    document.querySelectorAll('.relacao-row').forEach((tr) => {
      const dia = tr.dataset.dia;
      const plantaoInput = tr.querySelector('[data-field="plantao"]');
      const periodoInput = tr.querySelector('[data-field="periodo"]');
      const horasInput = tr.querySelector('[data-field="total_horas"]');

      const plantao = plantaoInput ? plantaoInput.value.trim() : '';
      const periodo = periodoInput ? periodoInput.value.trim() : '';
      const horas = horasInput ? Number(horasInput.value) || 0 : 0;

      if (plantao) {
        novaRelacao.push({
          dia_semana: dia,
          plantao,
          periodo,
          total_horas: horas,
        });
      }
    });

    // Adicionar linhas de TOTAL por dia
    /** @type {Object<string, number>} */
    const totaisPorDia = {};
    novaRelacao.forEach((r) => {
      const dia = r.dia_semana;
      totaisPorDia[dia] = (totaisPorDia[dia] || 0) + r.total_horas;
    });

    Object.entries(totaisPorDia).forEach(([dia, total]) => {
      novaRelacao.push({
        dia_semana: dia,
        plantao: 'TOTAL',
        periodo: '',
        total_horas: total,
      });
    });

    window.UI.showLoading('Salvando relação de plantões...');

    const result = await window.Api.request('salvar_relacao', { relacao: novaRelacao });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao salvar.', 'error');
      return;
    }

    state.editando = false;
    state.relacaoAtual = novaRelacao;

    window.UI.showToast('Relação de plantões salva com sucesso!', 'success');

    const container = document.getElementById('relacaoContainer');
    if (container) {
      await renderRelacaoEditor(container);
    }
  };

  // ─── API pública ───────────────────────────────────────────

  window.Teto = {
    carregarTetoVigencia,
    renderRelacaoEditor,
  };
})();
