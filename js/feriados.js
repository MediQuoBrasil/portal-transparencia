/**
 * ═══════════════════════════════════════════════════════════
 *  feriados.js — Calendário visual de feriados
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Calendário visual com 12 meses do ano selecionado
 *  - Clique para marcar/desmarcar feriados (admin only)
 *  - Bolinhas roxas nos dias marcados como feriado
 *  - Campo de descrição ao marcar um feriado
 *  - Salvamento e carregamento do backend
 */

(function () {
  'use strict';

  // ─── Typedefs ──────────────────────────────────────────────

  /**
   * @typedef {Object} Feriado
   * @property {string} data      - Data "YYYY-MM-DD"
   * @property {string} descricao - Descrição
   * @property {string} tipo      - Tipo do feriado
   */

  /**
   * @typedef {Object} FeriadoState
   * @property {number}    anoAtivo  - Ano selecionado
   * @property {Feriado[]} feriados  - Feriados carregados
   * @property {boolean}   dirty     - Se há alterações não salvas
   */

  /** @type {FeriadoState} */
  const state = {
    anoAtivo: new Date().getFullYear(),
    feriados: [],
    dirty: false,
  };

  // ─── Constantes ────────────────────────────────────────────

  /** @type {string[]} */
  const MESES_NOME = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril',
    'Maio', 'Junho', 'Julho', 'Agosto',
    'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];

  /** @type {string[]} */
  const DIAS_SIGLA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * Retorna o número de dias em um mês.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {number}
   */
  const diasNoMes = (ano, mes) => new Date(ano, mes, 0).getDate();

  /**
   * Retorna o dia da semana do primeiro dia do mês (0=Dom).
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {number}
   */
  const primeiroDiaDaSemana = (ano, mes) => new Date(ano, mes - 1, 1).getDay();

  /**
   * Formata data para "YYYY-MM-DD".
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @param {number} dia - Dia.
   * @returns {string}
   */
  const formatDateISO = (ano, mes, dia) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${ano}-${pad(mes)}-${pad(dia)}`;
  };

  /**
   * Verifica se uma data é feriado no state.
   *
   * @param {string} dataISO - Data "YYYY-MM-DD".
   * @returns {Feriado|undefined}
   */
  const buscarFeriado = (dataISO) => state.feriados.find((f) => f.data === dataISO);

  // ─── Renderização ──────────────────────────────────────────

  /**
   * Renderiza a interface completa de feriados em um container.
   *
   * @param {HTMLElement} container - Container alvo.
   * @param {number} [ano] - Ano a exibir (default: anoAtivo).
   */
  const render = async (container, ano) => {
    if (ano) state.anoAtivo = ano;

    container.innerHTML = '<div class="teto-loading"><span class="spinner"></span> Carregando feriados...</div>';

    const result = await window.Api.request('listar_feriados', { ano: state.anoAtivo });

    if (!result.ok) {
      container.innerHTML = `
        <div class="card">
          <div class="teto-error">${window.Utils.escapeHtml(result.error || 'Erro ao carregar feriados.')}</div>
        </div>
      `;
      return;
    }

    state.feriados = result.data.feriados || [];
    state.dirty = false;

    container.innerHTML = renderCalendar();
    bindCalendarEvents(container);
  };

  /**
   * Renderiza o calendário de 12 meses.
   *
   * @returns {string} HTML.
   */
  const renderCalendar = () => {
    const session = window.Auth.getSession();
    const isAdmin = session?.role === 'admin';

    const monthsHtml = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((mes) => renderMonth(state.anoAtivo, mes))
      .join('');

    const feriadosList = state.feriados
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((f) => {
        const parts = f.data.split('-');
        const dataFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
        return `
          <div class="feriado-list-item" data-data="${f.data}">
            <span class="feriado-list-dot"></span>
            <span class="feriado-list-date">${dataFmt}</span>
            <span class="feriado-list-desc">${window.Utils.escapeHtml(f.descricao || 'Sem descrição')}</span>
            ${isAdmin ? `<button type="button" class="feriado-remove-btn" data-data="${f.data}" title="Remover">×</button>` : ''}
          </div>
        `;
      }).join('');

    return `
      <div class="card feriados-card">
        <div class="feriados-card-header">
          <div class="feriados-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Feriados ${state.anoAtivo}
          </div>
          <div class="feriados-card-meta">
            <span class="relacao-total-badge">${state.feriados.length} feriado${state.feriados.length !== 1 ? 's' : ''}</span>
            ${isAdmin && state.dirty ? `
              <button type="button" class="btn btn--sm btn--accent" id="feriadosSalvar">Salvar alterações</button>
            ` : ''}
          </div>
        </div>

        ${isAdmin ? '<p class="feriados-hint">Clique em um dia para marcar ou desmarcar como feriado.</p>' : ''}

        <div class="calendar-grid">${monthsHtml}</div>

        ${feriadosList ? `
          <div class="feriados-list-section">
            <div class="feriados-list-title">Feriados cadastrados</div>
            <div class="feriados-list">${feriadosList}</div>
          </div>
        ` : ''}
      </div>
    `;
  };

  /**
   * Renderiza um mês individual do calendário.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {string} HTML.
   */
  const renderMonth = (ano, mes) => {
    const totalDias = diasNoMes(ano, mes);
    const startDay = primeiroDiaDaSemana(ano, mes);

    // Header com siglas dos dias
    const headerCells = DIAS_SIGLA.map((d) => `<span class="cal-day-header">${d}</span>`).join('');

    // Células vazias no início
    let cells = '';
    for (let i = 0; i < startDay; i += 1) {
      cells += '<span class="cal-day cal-day--empty"></span>';
    }

    // Dias do mês
    const hoje = new Date();
    const hojeISO = formatDateISO(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());

    for (let dia = 1; dia <= totalDias; dia += 1) {
      const dataISO = formatDateISO(ano, mes, dia);
      const feriado = buscarFeriado(dataISO);
      const isHoje = dataISO === hojeISO;

      let classes = 'cal-day';
      if (feriado) classes += ' cal-day--feriado';
      if (isHoje) classes += ' cal-day--hoje';

      const dayOfWeek = new Date(ano, mes - 1, dia).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) classes += ' cal-day--fds';

      cells += `
        <span class="${classes}" data-date="${dataISO}" title="${feriado ? window.Utils.escapeHtml(feriado.descricao || 'Feriado') : ''}">
          ${dia}
          ${feriado ? '<span class="cal-dot"></span>' : ''}
        </span>
      `;
    }

    return `
      <div class="cal-month">
        <div class="cal-month-name">${MESES_NOME[mes - 1]}</div>
        <div class="cal-grid">
          ${headerCells}
          ${cells}
        </div>
      </div>
    `;
  };

  // ─── Eventos ───────────────────────────────────────────────

  /**
   * Vincula eventos do calendário.
   *
   * @param {HTMLElement} container - Container pai.
   */
  const bindCalendarEvents = (container) => {
    const session = window.Auth.getSession();
    const isAdmin = session?.role === 'admin';

    // Clique em dias (admin only)
    if (isAdmin) {
      container.querySelectorAll('.cal-day:not(.cal-day--empty)').forEach((el) => {
        el.addEventListener('click', () => {
          toggleFeriado(el.dataset.date, container);
        });
      });
    }

    // Botão salvar
    const salvarBtn = document.getElementById('feriadosSalvar');
    if (salvarBtn) {
      salvarBtn.addEventListener('click', () => { salvarFeriados(container); });
    }

    // Botões remover na lista
    container.querySelectorAll('.feriado-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const { data } = btn.dataset;
        removeFeriadoLocal(data, container);
      });
    });
  };

  /**
   * Alterna feriado para uma data. Se já é feriado, remove. Senão, pede descrição.
   *
   * @param {string} dataISO - Data "YYYY-MM-DD".
   * @param {HTMLElement} container - Container para re-render.
   */
  const toggleFeriado = (dataISO, container) => {
    const existente = buscarFeriado(dataISO);

    if (existente) {
      // Remover
      state.feriados = state.feriados.filter((f) => f.data !== dataISO);
      state.dirty = true;
    } else {
      // Adicionar — pedir descrição
      const parts = dataISO.split('-');
      const dataFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
      const descricao = prompt(`Descrição do feriado em ${dataFmt} (opcional):`) || '';

      state.feriados.push({
        data: dataISO,
        descricao: descricao.trim(),
        tipo: 'personalizado',
      });
      state.dirty = true;
    }

    // Re-render
    container.innerHTML = renderCalendar();
    bindCalendarEvents(container);
  };

  /**
   * Remove feriado da lista local.
   *
   * @param {string} dataISO - Data a remover.
   * @param {HTMLElement} container - Container para re-render.
   */
  const removeFeriadoLocal = (dataISO, container) => {
    state.feriados = state.feriados.filter((f) => f.data !== dataISO);
    state.dirty = true;
    container.innerHTML = renderCalendar();
    bindCalendarEvents(container);
  };

  /**
   * Salva os feriados no backend.
   *
   * @param {HTMLElement} container - Container para re-render.
   */
  const salvarFeriados = async (container) => {
    window.UI.showLoading('Salvando feriados...');

    const result = await window.Api.request('salvar_feriados', {
      ano: state.anoAtivo,
      feriados: state.feriados.map((f) => ({
        data: f.data,
        descricao: f.descricao || '',
        tipo: f.tipo || 'personalizado',
      })),
    });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao salvar feriados.', 'error');
      return;
    }

    state.dirty = false;

    window.UI.showToast('Feriados salvos com sucesso!', 'success');

    container.innerHTML = renderCalendar();
    bindCalendarEvents(container);

    // Atualizar teto após salvar feriados
    window.Vigencias.refreshTetoVigencia();
  };

  // ─── API pública ───────────────────────────────────────────

  window.Feriados = {
    render,
  };
})();
