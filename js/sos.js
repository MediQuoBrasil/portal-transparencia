/**
 * ═══════════════════════════════════════════════════════════
 *  sos.js — Página SOS — Banco de Horas Emergencial
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Resumo anual SOS por vigência (tabela com limite/realizado/%)
 *  - Detalhe expandível por vigência (plantões SOS)
 *  - Edição de limites (admin only)
 *  - Histórico de alterações (timeline read-only)
 *
 *  Dependências:
 *  - window.Api      (request)
 *  - window.UI       (showLoading, hideLoading, showToast, escapeHtml)
 *  - window.Utils    (formatarMoeda, escapeHtml)
 *  - window.Auth     (getSession)
 */
 
(function () {
  'use strict';
 
  // ─── Typedefs ──────────────────────────────────────────────
 
  /**
   * @typedef {Object} SosState
   * @property {number[]}  anos        - Anos disponíveis
   * @property {number}    anoAtivo    - Ano selecionado
   * @property {Object|null} resumo    - Resumo SOS anual do backend
   * @property {Object|null} limites   - Limites SOS do backend
   * @property {Object|null} historico - Histórico SOS do backend
   * @property {string}    filtro      - 'cronologico' | 'maior_carga'
   * @property {number|null} vigenciaAberta - Índice do mês expandido (0–11)
   */
 
  /** @type {SosState} */
  const state = {
    anos: [],
    anoAtivo: 0,
    resumo: null,
    limites: null,
    historico: null,
    filtro: 'cronologico',
    vigenciaAberta: null,
  };
 
  // ─── Constantes ──────────────────────────────────────────
 
  /** @type {string[]} */
  const MESES_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril',
    'Maio', 'Junho', 'Julho', 'Agosto',
    'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
 
  // ─── Render principal ────────────────────────────────────
 
  /**
   * Ponto de entrada: renderiza a página SOS completa.
   *
   * @param {number[]} anos - Anos disponíveis.
   * @returns {Promise<void>}
   */
  const render = async (anos) => {
    state.anos = anos;
    state.anoAtivo = state.anoAtivo || (anos.length > 0 ? anos[anos.length - 1] : new Date().getFullYear());
    state.vigenciaAberta = null;
 
    const mainBody = document.getElementById('mainBody');
    if (!mainBody) return;
 
    const mainTitle = document.getElementById('mainHeaderTitle');
    const mainSubtitle = document.getElementById('mainHeaderSubtitle');
    if (mainTitle) mainTitle.textContent = 'SOS — Banco de Horas Emergencial';
    if (mainSubtitle) mainSubtitle.textContent = '';
 
    mainBody.innerHTML = renderPage();
    bindYearSelector();
 
    try {
      await carregarDados();
    } catch (err) {
      console.error('[SOS] Erro ao carregar dados:', err);
      const container = document.getElementById('sosContent');
      if (container) {
        container.innerHTML = '<div class="sos-error">Erro ao carregar dados SOS. Tente novamente.</div>';
      }
    }
  };
 
  /**
   * Renderiza o esqueleto da página.
   *
   * @returns {string} HTML.
   */
  const renderPage = () => {
    const yearOptions = state.anos
      .map((a) => `<option value="${a}"${a === state.anoAtivo ? ' selected' : ''}>${a}</option>`)
      .join('');
 
    return `
      <div class="sos-page">
        <div class="sos-toolbar">
          <div class="sos-toolbar-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span class="sos-toolbar-title">SOS — Banco de Horas Emergencial</span>
          </div>
          <div class="sos-toolbar-right">
            <select class="sos-year-select" id="sosYearSelect">${yearOptions}</select>
          </div>
        </div>
 
        <div id="sosContent">
          <div class="sos-loading">
            <span class="spinner"></span> Carregando dados SOS...
          </div>
        </div>
      </div>
    `;
  };
 
  // ─── Carregamento de dados ────────────────────────────────
 
  /**
   * Carrega resumo, limites e histórico em paralelo.
   *
   * @returns {Promise<void>}
   */
  const carregarDados = async () => {
    const container = document.getElementById('sosContent');
    if (!container) return;
 
    container.innerHTML = '<div class="sos-loading"><span class="spinner"></span> Carregando dados SOS...</div>';
 
    /** @type {Array<{ok: boolean, data?: *, error?: string}>} */
    let results;
 
    try {
      results = await Promise.all([
        window.Api.request('resumo_sos_anual', { ano: state.anoAtivo }),
        window.Api.request('obter_limites_sos', { ano: state.anoAtivo }),
        window.Api.request('obter_historico_sos', { ano: state.anoAtivo }),
      ]);
    } catch (err) {
      console.error('[SOS] Erro nas chamadas API:', err);
      container.innerHTML = '<div class="sos-error">Erro de comunicação ao carregar dados SOS.</div>';
      return;
    }
 
    const [resumoRes, limitesRes, historicoRes] = results;
 
    if (!resumoRes || !resumoRes.ok) {
      const msg = (resumoRes && resumoRes.error) || 'Erro ao carregar resumo SOS.';
      container.innerHTML = `<div class="sos-error">${window.Utils.escapeHtml(msg)}</div>`;
      return;
    }
 
    state.resumo = resumoRes.data;
    state.limites = (limitesRes && limitesRes.ok) ? limitesRes.data : null;
    state.historico = (historicoRes && historicoRes.ok) ? historicoRes.data : null;
 
    try {
      renderContent(container);
    } catch (err) {
      console.error('[SOS] Erro ao renderizar conteúdo:', err);
      container.innerHTML = '<div class="sos-error">Erro ao renderizar dados SOS. Verifique o console.</div>';
    }
  };
 
  /**
   * Renderiza o conteúdo completo (resumo + limites + histórico).
   *
   * @param {HTMLElement} container - Container alvo.
   */
  const renderContent = (container) => {
    if (!container || !state.resumo) return;
 
    const session = window.Auth.getSession();
    const isAdmin = session?.role === 'admin';
 
    container.innerHTML = `
      ${renderResumoAnual()}
      <div id="sosDetalheContainer"></div>
      ${isAdmin ? renderLimitesEditor() : ''}
      ${renderHistorico()}
    `;
 
    bindFiltros();
    bindResumoToggle();
    bindLimitesEvents();
  };
 
  // ─── Resumo Anual ─────────────────────────────────────────
 
  /**
   * Renderiza a tabela de resumo anual SOS.
   *
   * @returns {string} HTML.
   */
  const renderResumoAnual = () => {
    if (!state.resumo) return '';
 
    const { meses } = state.resumo;
 
    // Aplicar filtro
    let sorted = [...meses];
    if (state.filtro === 'maior_carga') {
      sorted.sort((a, b) => b.realizado_horas - a.realizado_horas);
    }
 
    const rowsHtml = sorted.map((m, idx) => {
      const pctStr = m.limite_horas > 0
        ? `${m.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        : '—';
      const hasData = m.realizado_horas > 0;
      const rowClass = hasData ? 'sos-resumo-row sos-resumo-row--active' : 'sos-resumo-row';
 
      return `
        <tr class="${rowClass}" data-sos-mes="${m.mes}" data-sos-idx="${idx}">
          <td class="sos-resumo-nome">
            <span>${window.Utils.escapeHtml(m.nome)}</span>
            ${hasData ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sos-chevron"><polyline points="6 9 12 15 18 9"/></svg>' : ''}
          </td>
          <td class="num">${m.limite_horas}h</td>
          <td class="num">${m.realizado_horas > 0 ? `${m.realizado_horas}h` : '0h'}</td>
          <td class="num">${pctStr}</td>
        </tr>
      `;
    }).join('');
 
    return `
      <div class="card sos-resumo-card">
        <div class="sos-card-header">
          <span class="sos-card-title">Resumo Anual</span>
          <div class="sos-card-header-right">
            <div class="sos-filtros">
              <button type="button" class="sos-filtro-btn${state.filtro === 'cronologico' ? ' active' : ''}" data-sos-filtro="cronologico">
                Sequência do ano
              </button>
              <button type="button" class="sos-filtro-btn${state.filtro === 'maior_carga' ? ' active' : ''}" data-sos-filtro="maior_carga">
                Maior carga
              </button>
            </div>
            <span class="sos-card-badge">${state.anoAtivo}</span>
          </div>
        </div>
        <table class="sos-resumo-table">
          <thead>
            <tr>
              <th>Vigência</th>
              <th class="num">Limite</th>
              <th class="num">Realizado</th>
              <th class="num">%</th>
            </tr>
          </thead>
          <tbody id="sosResumoTbody">${rowsHtml}</tbody>
        </table>
      </div>
    `;
  };
 
  // ─── Editor de limites (admin) ────────────────────────────
 
  /**
   * Renderiza a seção de edição de limites.
   * Visível apenas para admins.
   *
   * @returns {string} HTML.
   */
  const renderLimitesEditor = () => {
    if (!state.limites) return '';
 
    const { meses } = state.limites;
 
    const rowsHtml = meses.map((m) => `
      <tr class="sos-lim-row" data-lim-mes="${m.mes}">
        <td>${window.Utils.escapeHtml(m.nome)}</td>
        <td>
          <div class="sos-lim-input-wrap">
            <input type="number" class="sos-lim-input" id="sosLimInput_${m.mes}"
                   value="${m.limite_horas}" min="0" max="744" step="1">
            <span class="sos-lim-unit">h</span>
          </div>
        </td>
        <td>
          <button type="button" class="sos-lim-save-btn" data-lim-mes="${m.mes}" data-lim-original="${m.limite_horas}">
            Salvar
          </button>
        </td>
      </tr>
    `).join('');
 
    return `
      <div class="card sos-lim-card">
        <div class="sos-card-header">
          <span class="sos-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Definir limites
          </span>
          <span class="sos-card-badge">Admin</span>
        </div>
        <table class="sos-lim-table">
          <thead>
            <tr>
              <th>Vigência</th>
              <th>Limite</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  };
 
  // ─── Histórico ────────────────────────────────────────────
 
  /**
   * Renderiza o histórico de alterações de limites SOS.
   * Mesmo padrão de timeline de js_teto.js:renderHistoricoAlteracoes.
   *
   * @returns {string} HTML.
   */
  const renderHistorico = () => {
    const historicoArr = state.historico && Array.isArray(state.historico.historico)
      ? state.historico.historico
      : [];
    if (historicoArr.length === 0) return '';
 
    const entries = historicoArr;
 
    const timelineHtml = entries.map((h) => {
      const mesNum = parseInt(h.vigencia_id.split('-')[1], 10);
      const mesNome = MESES_PT[mesNum - 1] || h.vigencia_id;
 
      const dataFmt = h.alterado_em
        ? new Date(h.alterado_em).toLocaleDateString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
        : '';
 
      return `
        <div class="hist-entry">
          <div class="hist-entry-marker">
            <span class="hist-entry-dot sos-hist-dot"></span>
            <span class="hist-entry-line"></span>
          </div>
          <div class="hist-entry-content">
            <div class="hist-entry-date">${window.Utils.escapeHtml(mesNome)}</div>
            <div class="hist-entry-details">
              <div class="hist-detail">
                <span class="hist-detail-dia">Limite SOS</span>
                <span class="hist-detail-horas">
                  <span class="hist-horas-ant">${h.limite_anterior}h</span> → <span class="hist-horas-nova">${h.limite_novo}h</span>
                </span>
              </div>
              <div class="sos-hist-meta">
                ${window.Utils.escapeHtml(h.alterado_por)} · ${dataFmt}
              </div>
            </div>
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
            Histórico de Alterações — SOS
          </div>
          <span class="relacao-total-badge">${entries.length} registro${entries.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="hist-timeline">${timelineHtml}</div>
      </div>
    `;
  };
 
  // ─── Event Binding ────────────────────────────────────────
 
  /**
   * Vincula eventos do seletor de ano.
   */
  const bindYearSelector = () => {
    const sel = document.getElementById('sosYearSelect');
    if (!sel) return;
    sel.addEventListener('change', () => {
      state.anoAtivo = Number(sel.value);
      state.vigenciaAberta = null;
      carregarDados();
    });
  };
 
  /**
   * Vincula eventos dos filtros de ordenação.
   */
  const bindFiltros = () => {
    document.querySelectorAll('.sos-filtro-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filtro = btn.dataset.sosFiltro;
        state.vigenciaAberta = null;
        const container = document.getElementById('sosContent');
        if (container) renderContent(container);
      });
    });
  };
 
  /**
   * Vincula expand/collapse nas linhas do resumo anual.
   */
  const bindResumoToggle = () => {
    document.querySelectorAll('.sos-resumo-row--active').forEach((row) => {
      row.addEventListener('click', async () => {
        const mes = Number(row.dataset.sosMes);
 
        if (state.vigenciaAberta === mes) {
          state.vigenciaAberta = null;
          document.querySelectorAll('.sos-resumo-row').forEach((r) => r.classList.remove('expanded'));
          const detalheContainer = document.getElementById('sosDetalheContainer');
          if (detalheContainer) detalheContainer.innerHTML = '';
          return;
        }
 
        state.vigenciaAberta = mes;
        document.querySelectorAll('.sos-resumo-row').forEach((r) => r.classList.remove('expanded'));
        row.classList.add('expanded');
 
        await carregarDetalheVigencia(mes);
      });
    });
  };
 
  /**
   * Vincula eventos nos botões de salvar limite.
   */
  const bindLimitesEvents = () => {
    document.querySelectorAll('.sos-lim-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mes = Number(btn.dataset.limMes);
        const input = document.getElementById(`sosLimInput_${mes}`);
        if (!input) return;
 
        const novoLimite = Number(input.value);
 
        if (isNaN(novoLimite) || novoLimite < 0 || novoLimite > 744) {
          window.UI.showToast('Limite inválido (0–744h).', 'error');
          return;
        }
 
        btn.disabled = true;
        btn.textContent = '...';
 
        const result = await window.Api.request('alterar_limite_sos', {
          ano: state.anoAtivo,
          mes,
          limite_horas: novoLimite,
        });
 
        btn.disabled = false;
        btn.textContent = 'Salvar';
 
        if (!result.ok) {
          window.UI.showToast(result.error || 'Erro ao salvar limite.', 'error');
          return;
        }
 
        if (result.data.alterado) {
          window.UI.showToast(`Limite de ${MESES_PT[mes - 1]} atualizado para ${novoLimite}h.`, 'success');
          btn.dataset.limOriginal = String(novoLimite);
          await carregarDados(); // Recarregar tudo
        } else {
          window.UI.showToast('Sem alteração.', 'info');
        }
      });
    });
  };
 
  // ─── Detalhe por vigência ─────────────────────────────────
 
  /**
   * Carrega e renderiza o detalhe de plantões SOS de uma vigência.
   *
   * @param {number} mes - Mês (1–12).
   * @returns {Promise<void>}
   */
  const carregarDetalheVigencia = async (mes) => {
    const container = document.getElementById('sosDetalheContainer');
    if (!container) return;
 
    container.innerHTML = '<div class="sos-loading"><span class="spinner"></span> Carregando detalhe...</div>';
 
    const result = await window.Api.request('detalhe_vigencia', {
      ano: state.anoAtivo,
      mes,
    });
 
    if (!result.ok || !result.data.temDados) {
      container.innerHTML = `
        <div class="card sos-detalhe-card">
          <div class="sos-card-header">
            <span class="sos-card-title">${MESES_PT[mes - 1]}/${state.anoAtivo} — SOS</span>
          </div>
          <div class="sos-detalhe-empty">Nenhum dado de plantão encontrado para esta vigência.</div>
        </div>
      `;
      return;
    }
 
    const registros = result.data.registros || [];
    const sosPl = registros.filter((r) => {
      const tipo = String(r.tipo || '').trim().toUpperCase();
      return tipo === 'SOS';
    });
 
    if (sosPl.length === 0) {
      container.innerHTML = `
        <div class="card sos-detalhe-card">
          <div class="sos-card-header">
            <span class="sos-card-title">${MESES_PT[mes - 1]}/${state.anoAtivo} — SOS</span>
          </div>
          <div class="sos-detalhe-empty">Nenhum plantão SOS nesta vigência.</div>
        </div>
      `;
      return;
    }
 
    // Agregar por profissional
    let totalHoras = 0;
    let totalValor = 0;
 
    const rowsHtml = sosPl.map((pl) => {
      const duracaoStr = String(pl.duracao_h || '').trim();
      const timeMatch = duracaoStr.match(/^(\d{1,3}):(\d{2})$/);
      const horas = timeMatch
        ? parseInt(timeMatch[1], 10) + parseInt(timeMatch[2], 10) / 60
        : 0;
      totalHoras += horas;
      totalValor += pl.valor;
 
      const inicioFmt = String(pl.inicio || '').substring(0, 16);
      const fimFmt = String(pl.fim || '').substring(0, 16);
 
      return `
        <tr>
          <td>${window.Utils.escapeHtml(pl.profissional)}</td>
          <td>${window.Utils.escapeHtml(inicioFmt)}</td>
          <td>${window.Utils.escapeHtml(fimFmt)}</td>
          <td class="num">${duracaoStr}</td>
          <td class="num">${window.Utils.formatarMoeda(pl.valor)}</td>
        </tr>
      `;
    }).join('');
 
    const totalHorasFmt = `${Math.floor(totalHoras)}h${Math.round((totalHoras % 1) * 60) > 0 ? `${Math.round((totalHoras % 1) * 60).toString().padStart(2, '0')}min` : ''}`;
 
    container.innerHTML = `
      <div class="card sos-detalhe-card">
        <div class="sos-card-header">
          <span class="sos-card-title">${MESES_PT[mes - 1]}/${state.anoAtivo} — SOS</span>
          <span class="sos-badge">${sosPl.length} plantão${sosPl.length !== 1 ? 'ões' : ''}</span>
        </div>
        <table class="sos-detalhe-table">
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Início</th>
              <th>Fim</th>
              <th class="num">Dur.</th>
              <th class="num">R$</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="sos-detalhe-total">
              <td colspan="3">Total</td>
              <td class="num">${totalHorasFmt}</td>
              <td class="num">${window.Utils.formatarMoeda(totalValor)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  };
 
  // ─── API pública ──────────────────────────────────────────
 
  window.Sos = { render };
})();
