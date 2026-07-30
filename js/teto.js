/**
 * ═══════════════════════════════════════════════════════════
 *  teto.js — Relação de plantões, alterações e cálculo de teto
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Exibição do teto por vigência (integrado ao detalhe)
 *  - Interface de edição da relação de plantões (admin)
 *  - Exibição do detalhamento diário do teto
 *  - Comparação teto × realizado
 *  - Fluxo de salvar com data efetiva (substitui CRUD de alterações avulsas)
 *  - Histórico de alterações por vigência
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
   * @typedef {Object} AlteracaoRelacao
   * @property {string} data_inicio      - Data ISO "YYYY-MM-DD"
   * @property {string} dia_semana       - Dia da semana afetado
   * @property {number} total_horas      - Novo total de horas
   * @property {number} horas_anteriores - Total de horas antes da alteração
   * @property {string} criado_em        - Timestamp de criação
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
   * @property {PlantaoEntry[]}      relacaoAtual    - Relação de plantões atual (do backend)
   * @property {PlantaoEntry[]}      relacaoOriginal - Cópia da relação antes da edição (p/ detectar diffs)
   * @property {boolean}             editando        - Se está editando a relação
   * @property {AlteracaoRelacao[]}  alteracoes      - Alterações datadas carregadas
   */

  /** @type {TetoState} */
  const state = {
    relacaoAtual: [],
    relacaoOriginal: [],
    editando: false,
    alteracoes: [],
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
      let rowClass = 'teto-detail-row';
      if (d.eh_feriado) rowClass += ' teto-row--feriado';
      if (d.eh_alterado) rowClass += ' teto-row--alterado';

      return `
        <tr class="${rowClass}">
          <td>${fmtData}</td>
          <td>${d.dia_semana}</td>
          <td class="num">${d.horas}h</td>
          <td class="num">${window.Utils.formatarMoeda(d.valor_dia)}</td>
          <td>
            ${d.eh_feriado ? '<span class="teto-feriado-dot" title="Feriado"></span>' : ''}
            ${d.eh_alterado ? '<span class="teto-alterado-dot" title="Alteração de escala"></span>' : ''}
          </td>
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

  // ─── Helpers: totais por dia ─────────────────────────────────

  /**
   * Extrai os totais de horas por dia da semana a partir da relação.
   *
   * @param {PlantaoEntry[]} relacao - Registros da relação.
   * @returns {Object<string, number>} Mapa dia_key → total de horas.
   */
  const extrairTotaisPorDia = (relacao) => {
    /** @type {Object<string, number>} */
    const totais = {};
    DIAS_KEY.forEach((d) => { totais[d] = 0; });

    relacao.forEach((r) => {
      const dia = normalizarDiaKey(r.dia_semana);
      if (!dia) return;

      if (r.plantao.toUpperCase() === 'TOTAL') {
        totais[dia] = r.total_horas;
      }
    });

    // Se não existem linhas TOTAL, somar plantões individuais
    DIAS_KEY.forEach((d) => {
      if (totais[d] === 0) {
        relacao.forEach((r) => {
          const rDia = normalizarDiaKey(r.dia_semana);
          if (rDia === d && r.plantao.toUpperCase() !== 'TOTAL') {
            totais[d] += r.total_horas;
          }
        });
      }
    });

    return totais;
  };

  /**
   * Normaliza qualquer grafia de dia da semana para a chave canônica.
   *
   * @param {string} dia - Nome do dia.
   * @returns {string|null} Chave normalizada ou null.
   */
  const normalizarDiaKey = (dia) => {
    const lower = String(dia || '').toLowerCase().trim();
    const semAcento = lower
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return DIAS_KEY.find((k) => {
      const kSemAcento = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return lower === k || semAcento === kSemAcento;
    }) || null;
  };

  // ─── Edição da Relação de Plantões ────────────────────────

  /**
   * Renderiza a interface de edição da relação de plantões.
   * Também carrega e exibe o histórico de alterações datadas.
   *
   * @param {HTMLElement} container - Container alvo.
   */
  const renderRelacaoEditor = async (container) => {
    container.innerHTML = '<div class="teto-loading"><span class="spinner"></span> Carregando relação de plantões...</div>';

    // Carregar relação e alterações em paralelo
    const [relResult, altResult] = await Promise.all([
      window.Api.request('obter_relacao'),
      window.Api.request('listar_alteracoes'),
    ]);

    if (!relResult.ok) {
      container.innerHTML = `
        <div class="card">
          <div class="teto-error">${window.Utils.escapeHtml(relResult.error || 'Erro ao carregar relação.')}</div>
        </div>
      `;
      return;
    }

    state.relacaoAtual = relResult.data.relacao || [];
    state.relacaoOriginal = JSON.parse(JSON.stringify(state.relacaoAtual));
    state.alteracoes = (altResult.ok && altResult.data.alteracoes) || [];

    container.innerHTML = renderRelacaoView() + renderHistoricoAlteracoes();
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
      const dia = normalizarDiaKey(r.dia_semana);
      if (dia && byDay[dia]) {
        byDay[dia].push(r);
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
        // Guardar cópia antes de editar
        state.relacaoOriginal = JSON.parse(JSON.stringify(state.relacaoAtual));
        state.editando = true;
        const container = document.getElementById('relacaoContainer');
        if (container) {
          container.innerHTML = renderRelacaoView() + renderHistoricoAlteracoes();
          bindRelacaoEvents();
        }
      });
    }

    if (cancelarBtn) {
      cancelarBtn.addEventListener('click', () => {
        state.editando = false;
        // Restaurar relação original (descartar edições)
        state.relacaoAtual = JSON.parse(JSON.stringify(state.relacaoOriginal));
        const container = document.getElementById('relacaoContainer');
        if (container) {
          renderRelacaoEditor(container);
        }
      });
    }

    if (salvarBtn) {
      salvarBtn.addEventListener('click', iniciarFluxoSalvar);
    }

    // Add buttons
    document.querySelectorAll('.relacao-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        adicionarPlantao(btn.dataset.dia);
      });
    });

    // Remove buttons
    document.querySelectorAll('.relacao-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        removerPlantao(btn.dataset.dia, parseInt(btn.dataset.idx, 10));
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
      container.innerHTML = renderRelacaoView() + renderHistoricoAlteracoes();
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
    let count = 0;
    for (let i = 0; i < state.relacaoAtual.length; i += 1) {
      const r = state.relacaoAtual[i];
      const rDia = normalizarDiaKey(r.dia_semana);

      if (rDia === dia && r.plantao.toUpperCase() !== 'TOTAL') {
        if (count === idx) {
          state.relacaoAtual.splice(i, 1);
          break;
        }
        count += 1;
      }
    }

    const container = document.getElementById('relacaoContainer');
    if (container) {
      container.innerHTML = renderRelacaoView() + renderHistoricoAlteracoes();
      bindRelacaoEvents();
    }
  };

  // ─── Fluxo de salvar com data efetiva ─────────────────────

  /**
   * Coleta dados editados, detecta diffs e abre o modal de data.
   */
  const iniciarFluxoSalvar = () => {
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
      totaisPorDia[r.dia_semana] = (totaisPorDia[r.dia_semana] || 0) + r.total_horas;
    });

    Object.entries(totaisPorDia).forEach(([dia, total]) => {
      novaRelacao.push({
        dia_semana: dia,
        plantao: 'TOTAL',
        periodo: '',
        total_horas: total,
      });
    });

    // Detectar mudanças nos totais por dia
    const totaisAntigos = extrairTotaisPorDia(state.relacaoOriginal);
    const totaisNovos = extrairTotaisPorDia(novaRelacao);
    const diffs = detectarDiffs(totaisAntigos, totaisNovos);

    if (diffs.length === 0) {
      // Nenhuma mudança nos totais — salvar direto a relação sem criar alteração
      salvarRelacaoDireta(novaRelacao);
      return;
    }

    // Há mudanças — abrir modal pedindo a data
    abrirModalData(novaRelacao, diffs);
  };

  /**
   * Detecta dias cujo total de horas mudou.
   *
   * @param {Object<string, number>} antigos - Totais antigos.
   * @param {Object<string, number>} novos - Totais novos.
   * @returns {Array<{dia: string, label: string, de: number, para: number}>}
   */
  const detectarDiffs = (antigos, novos) => {
    /** @type {Array<{dia: string, label: string, de: number, para: number}>} */
    const diffs = [];

    DIAS_KEY.forEach((dia, idx) => {
      const de = antigos[dia] || 0;
      const para = novos[dia] || 0;
      if (de !== para) {
        diffs.push({
          dia,
          label: DIAS_LABEL[idx],
          de,
          para,
        });
      }
    });

    return diffs;
  };

  /**
   * Abre o modal que pergunta a data efetiva das alterações.
   *
   * @param {PlantaoEntry[]} novaRelacao - Relação com edições.
   * @param {Array<{dia: string, label: string, de: number, para: number}>} diffs - Dias alterados.
   */
  const abrirModalData = (novaRelacao, diffs) => {
    // Remover modal anterior, se houver
    const existente = document.getElementById('modalAlteracaoData');
    if (existente) existente.remove();

    const diffsHtml = diffs.map((d) => `
      <div class="modal-diff-item">
        <span class="modal-diff-dia">${window.Utils.escapeHtml(d.label)}</span>
        <span class="modal-diff-de">${d.de}h</span>
        <span class="modal-diff-arrow">→</span>
        <span class="modal-diff-para">${d.para}h</span>
      </div>
    `).join('');

    const hoje = new Date();
    const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    const modal = document.createElement('div');
    modal.id = 'modalAlteracaoData';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Essas alterações iniciarão em qual data?
          </div>
        </div>

        <div class="modal-body">
          <p class="modal-desc">
            As seguintes mudanças foram detectadas na escala:
          </p>
          <div class="modal-diffs">${diffsHtml}</div>
          <p class="modal-desc modal-desc--subtle">
            A escala atual será mantida até a data informada. Após essa data, a nova escala entrará em vigor.
          </p>
          <div class="modal-field">
            <label class="modal-field-label" for="modalDataInicio">Data de início das alterações</label>
            <input type="date" id="modalDataInicio" class="modal-date-input" value="${hojeISO}" />
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn--sm btn--ghost" id="modalCancelar">Cancelar</button>
          <button type="button" class="btn btn--sm btn--accent" id="modalConfirmar">Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Forçar reflow para animar entrada
    requestAnimationFrame(() => { modal.classList.add('open'); });

    // Eventos
    const cancelarBtn = modal.querySelector('#modalCancelar');
    const confirmarBtn = modal.querySelector('#modalConfirmar');

    cancelarBtn.addEventListener('click', () => { fecharModal(modal); });
    confirmarBtn.addEventListener('click', () => {
      const dataInput = document.getElementById('modalDataInicio');
      const dataInicio = dataInput ? dataInput.value : '';

      if (!dataInicio || !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
        window.UI.showToast('Informe uma data válida.', 'error');
        return;
      }

      fecharModal(modal);
      salvarRelacaoComData(novaRelacao, diffs, dataInicio);
    });

    // Fechar no backdrop
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fecharModal(modal);
    });

    // Fechar com Esc
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        fecharModal(modal);
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  };

  /**
   * Fecha o modal com animação.
   *
   * @param {HTMLElement} modal - Elemento do modal.
   */
  const fecharModal = (modal) => {
    modal.classList.remove('open');
    setTimeout(() => { modal.remove(); }, 200);
  };

  /**
   * Salva a relação atualizada + cria alterações datadas para cada dia que mudou.
   *
   * @param {PlantaoEntry[]} novaRelacao - Relação editada completa.
   * @param {Array<{dia: string, label: string, de: number, para: number}>} diffs - Dias alterados.
   * @param {string} dataInicio - Data ISO "YYYY-MM-DD" efetiva.
   */
  const salvarRelacaoComData = async (novaRelacao, diffs, dataInicio) => {
    window.UI.showLoading('Salvando alterações...');

    const result = await window.Api.request('salvar_relacao_datada', {
      relacao: novaRelacao,
      alteracoes: diffs.map((d) => ({
        dia_semana: d.dia,
        total_horas: d.para,
        horas_anteriores: d.de,
      })),
      data_inicio: dataInicio,
    });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao salvar.', 'error');
      return;
    }

    state.editando = false;
    state.relacaoAtual = novaRelacao;

    const dataFmt = dataInicio.split('-').reverse().join('/');
    window.UI.showToast(`Escala atualizada a partir de ${dataFmt}.`, 'success');

    const container = document.getElementById('relacaoContainer');
    if (container) {
      await renderRelacaoEditor(container);
    }

    // Atualizar teto após salvar relação
    window.Vigencias.refreshTetoVigencia();
  };

  /**
   * Salva a relação diretamente (sem alterações de total — ex: nome/período mudou).
   *
   * @param {PlantaoEntry[]} novaRelacao - Relação editada.
   */
  const salvarRelacaoDireta = async (novaRelacao) => {
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

    window.Vigencias.refreshTetoVigencia();
  };

  // ─── Histórico de Alterações (read-only timeline) ──────────

  /**
   * Renderiza o histórico de alterações datadas como timeline read-only.
   * Mostra o registro de como a escala mudou ao longo do tempo.
   *
   * @returns {string} HTML.
   */
  const renderHistoricoAlteracoes = () => {
    if (state.alteracoes.length === 0) return '';

    const session = window.Auth.getSession();
    const isAdmin = session?.role === 'admin';

    // Agrupar por data_inicio
    /** @type {Object<string, AlteracaoRelacao[]>} */
    const byDate = {};
    state.alteracoes.forEach((alt) => {
      if (!byDate[alt.data_inicio]) byDate[alt.data_inicio] = [];
      byDate[alt.data_inicio].push(alt);
    });

    const dates = Object.keys(byDate).sort();

    const timelineHtml = dates.map((dataISO) => {
      const items = byDate[dataISO];
      const dataFmt = dataISO.split('-').reverse().join('/');

      const detailsHtml = items.map((alt) => {
        const diaLabel = DIAS_LABEL[DIAS_KEY.indexOf(alt.dia_semana)] || alt.dia_semana;
        const horasAnt = Number(alt.horas_anteriores) || 0;
        const horasNova = Number(alt.total_horas) || 0;
        const horasText = horasAnt > 0 && horasAnt !== horasNova
          ? `<span class="hist-horas-ant">${horasAnt}h</span> → <span class="hist-horas-nova">${horasNova}h</span>`
          : `${horasNova}h`;
        return `
          <div class="hist-detail" data-di="${alt.data_inicio}" data-ds="${alt.dia_semana}">
            <span class="hist-detail-dia">${window.Utils.escapeHtml(diaLabel)}</span>
            <span class="hist-detail-horas">${horasText}</span>
            ${isAdmin ? `<button type="button" class="hist-remove-btn" data-di="${alt.data_inicio}" data-ds="${alt.dia_semana}" title="Remover alteração">×</button>` : ''}
          </div>
        `;
      }).join('');

      return `
        <div class="hist-entry">
          <div class="hist-entry-marker">
            <span class="hist-entry-dot"></span>
            <span class="hist-entry-line"></span>
          </div>
          <div class="hist-entry-content">
            <div class="hist-entry-date">A partir de ${dataFmt}</div>
            <div class="hist-entry-details">${detailsHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="card hist-card">
        <div class="hist-card-header">
          <div class="hist-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <path d="M12 8v4l3 3"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
            Histórico de Alterações
          </div>
          <span class="relacao-total-badge">${state.alteracoes.length} registro${state.alteracoes.length !== 1 ? 's' : ''}</span>
        </div>

        <div class="hist-timeline">${timelineHtml}</div>
      </div>
    `;
  };

  /**
   * Vincula eventos de remoção no histórico de alterações.
   * Chamado após renderizar o container.
   *
   * @param {HTMLElement} container - Container pai.
   */
  const bindHistoricoEvents = (container) => {
    container.querySelectorAll('.hist-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removerAlteracaoHistorico(btn.dataset.di, btn.dataset.ds, container);
      });
    });
  };

  /**
   * Remove uma alteração do histórico e atualiza a UI.
   *
   * @param {string} dataInicio - Data ISO.
   * @param {string} diaSemana - Dia da semana.
   * @param {HTMLElement} container - Container para re-render.
   */
  const removerAlteracaoHistorico = async (dataInicio, diaSemana, container) => {
    if (!confirm('Remover esta alteração do histórico?')) return;

    window.UI.showLoading('Removendo alteração...');

    const result = await window.Api.request('remover_alteracao', {
      data_inicio: dataInicio,
      dia_semana: diaSemana,
    });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao remover.', 'error');
      return;
    }

    window.UI.showToast('Alteração removida do histórico.', 'success');

    // Atualizar state local
    state.alteracoes = state.alteracoes.filter(
      (a) => !(a.data_inicio === dataInicio && a.dia_semana === diaSemana),
    );

    // Re-render
    await renderRelacaoEditor(container);

    // Atualizar teto
    window.Vigencias.refreshTetoVigencia();
  };

  // ─── Override do renderRelacaoEditor para vincular histórico ──

  // Patch: após renderizar, vincular eventos do histórico
  const originalRenderRelacaoEditor = renderRelacaoEditor;

  /**
   * Wrapper que renderiza o editor e vincula eventos do histórico.
   *
   * @param {HTMLElement} container - Container alvo.
   */
  const renderRelacaoEditorWithHistory = async (container) => {
    await originalRenderRelacaoEditor(container);
    bindHistoricoEvents(container);
  };

  // ─── API pública ───────────────────────────────────────────

  window.Teto = {
    carregarTetoVigencia,
    renderRelacaoEditor: renderRelacaoEditorWithHistory,
    /** @param {TetoData} data */
    renderTetoCardHtml: renderTetoCard,
    bindTetoToggleBtn: bindTetoToggle,
  };
})();
