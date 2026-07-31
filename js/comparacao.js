/**
 * ═══════════════════════════════════════════════════════════
 *  comparacao.js — Comparação entre vigências
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Seleção de duas vigências (automática: atual vs anterior)
 *  - Tabela comparativa com todos os indicadores
 *  - Setas e variação percentual
 *  - Justificativas automáticas derivadas dos dados
 *
 *  Dependências:
 *  - window.Api      (request)
 *  - window.UI       (showToast)
 *  - window.Utils    (formatarMoeda, escapeHtml)
 *  - window.AppConfig (MESES)
 */

(function () {
  'use strict';

  // ─── Typedefs ──────────────────────────────────────────────

  /**
   * @typedef {Object} ComparacaoState
   * @property {number[]}    anos       - Anos disponíveis
   * @property {number}      anoA       - Ano vigência A
   * @property {number}      mesA       - Mês vigência A
   * @property {number}      anoB       - Ano vigência B
   * @property {number}      mesB       - Mês vigência B
   * @property {Object|null} resultado  - Dados da comparação
   */

  /** @type {ComparacaoState} */
  const state = {
    anos: [],
    anoA: 0,
    mesA: 0,
    anoB: 0,
    mesB: 0,
    resultado: null,
  };

  // ─── Constantes ────────────────────────────────────────────

  /**
   * Labels amigáveis para os indicadores.
   * @type {Object<string, string>}
   */
  const INDICADOR_LABELS = {
    total_dias: 'Total de Dias',
    dias_uteis: 'Dias Úteis',
    dias_fds: 'Fins de Semana',
    dias_feriado: 'Feriados',
    total_horas: 'Total de Horas',
    teto_valor: 'Teto (R$)',
    valor_realizado: 'Realizado (R$)',
    diferenca: 'Diferença (R$)',
  };

  /**
   * Indicadores que são formatados como moeda.
   * @type {Set<string>}
   */
  const INDICADORES_MOEDA = new Set(['teto_valor', 'valor_realizado', 'diferenca']);

  /**
   * Indicadores que são formatados com sufixo "h".
   * @type {Set<string>}
   */
  const INDICADORES_HORAS = new Set(['total_horas']);

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * Calcula vigência anterior dada uma referência.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   * @returns {{ ano: number, mes: number }}
   */
  const vigenciaAnterior = (ano, mes) => {
    if (mes <= 1) return { ano: ano - 1, mes: 12 };
    return { ano, mes: mes - 1 };
  };

  /**
   * Formata um valor de indicador para exibição.
   *
   * @param {string} campo - Nome do campo.
   * @param {number} valor - Valor numérico.
   * @returns {string} Valor formatado.
   */
  const formatarIndicador = (campo, valor) => {
    if (INDICADORES_MOEDA.has(campo)) {
      return window.Utils.formatarMoeda(valor);
    }
    if (INDICADORES_HORAS.has(campo)) {
      return `${valor.toLocaleString('pt-BR')}h`;
    }
    return String(valor);
  };

  /**
   * Formata a variação para exibição com seta.
   *
   * @param {Object} variacao - Dados de variação.
   * @returns {string} HTML da variação.
   */
  const renderVariacao = (variacao) => {
    const { delta, delta_pct, direcao } = variacao;

    if (direcao === 'equal') {
      return '<span class="comp-delta comp-delta--equal">—</span>';
    }

    const arrow = direcao === 'up' ? '↑' : '↓';
    const cls = direcao === 'up' ? 'comp-delta--up' : 'comp-delta--down';

    let deltaFormatted;
    if (INDICADORES_MOEDA.has(variacao.campo)) {
      deltaFormatted = window.Utils.formatarMoeda(Math.abs(delta));
    } else if (INDICADORES_HORAS.has(variacao.campo)) {
      deltaFormatted = `${Math.abs(delta).toLocaleString('pt-BR')}h`;
    } else {
      deltaFormatted = String(Math.abs(delta));
    }

    const pctStr = delta_pct !== 0
      ? `<span class="comp-delta-pct">${Math.abs(delta_pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`
      : '';

    return `
      <span class="comp-delta ${cls}">
        <span class="comp-delta-arrow">${arrow}</span>
        ${deltaFormatted}
        ${pctStr}
      </span>
    `;
  };

  // ─── Render: Tela principal ─────────────────────────────

  /**
   * Renderiza a tela completa de comparação.
   *
   * @param {number[]} anos - Anos disponíveis.
   * @param {number}   [anoAtual] - Ano ativo (para defaults).
   * @param {number}   [mesAtual] - Mês ativo (para defaults).
   * @returns {void}
   */
  const render = (anos, anoAtual, mesAtual) => {
    state.anos = anos;

    // Defaults: vigência atual vs anterior
    const agora = new Date();
    const anoRef = anoAtual || agora.getFullYear();
    const mesRef = mesAtual || agora.getMonth() + 1;

    state.anoB = anoRef;
    state.mesB = mesRef;
    const ant = vigenciaAnterior(anoRef, mesRef);
    state.anoA = ant.ano;
    state.mesA = ant.mes;

    const mainBody = document.getElementById('mainBody');
    if (!mainBody) return;

    // Header
    const titleEl = document.getElementById('mainHeaderTitle');
    const subtitleEl = document.getElementById('mainHeaderSubtitle');
    if (titleEl) titleEl.textContent = 'Comparação de Vigências';
    if (subtitleEl) subtitleEl.textContent = 'Análise lado a lado de indicadores';

    mainBody.innerHTML = renderShell();
    bindEvents();
    executarComparacao();
  };

  /**
   * Renderiza o shell da página de comparação.
   *
   * @returns {string} HTML.
   */
  const renderShell = () => {
    const optionsAnoA = renderAnoOptions(state.anoA);
    const optionsAnoB = renderAnoOptions(state.anoB);
    const optionsMesA = renderMesOptions(state.mesA);
    const optionsMesB = renderMesOptions(state.mesB);

    return `
      <div class="comp-page">
        <div class="comp-selectors">
          <div class="comp-selector-group">
            <div class="comp-selector-label">Vigência A (referência)</div>
            <div class="comp-selector-row">
              <select class="comp-select" id="compMesA">${optionsMesA}</select>
              <select class="comp-select" id="compAnoA">${optionsAnoA}</select>
            </div>
          </div>

          <div class="comp-vs">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </div>

          <div class="comp-selector-group">
            <div class="comp-selector-label">Vigência B (comparada)</div>
            <div class="comp-selector-row">
              <select class="comp-select" id="compMesB">${optionsMesB}</select>
              <select class="comp-select" id="compAnoB">${optionsAnoB}</select>
            </div>
          </div>

          <button type="button" class="btn btn--accent btn--sm" id="compExecuteBtn">
            Comparar
          </button>
        </div>

        <div class="comp-result" id="compResult">
          <!-- Renderizado após carregamento -->
        </div>
      </div>
    `;
  };

  /**
   * Gera options de ano para um select.
   *
   * @param {number} selected - Ano selecionado.
   * @returns {string} HTML das options.
   */
  const renderAnoOptions = (selected) => state.anos
    .map((a) => `<option value="${a}"${a === selected ? ' selected' : ''}>${a}</option>`)
    .join('');

  /**
   * Gera options de mês para um select.
   *
   * @param {number} selected - Mês selecionado (1-12).
   * @returns {string} HTML das options.
   */
  const renderMesOptions = (selected) => window.AppConfig.MESES
    .map((nome, i) => `<option value="${i + 1}"${(i + 1) === selected ? ' selected' : ''}>${nome}</option>`)
    .join('');

  // ─── Render: Resultado da comparação ───────────────────

  /**
   * Renderiza o resultado da comparação.
   *
   * @param {Object} dados - ComparacaoResult do backend.
   * @returns {string} HTML.
   */
  const renderResultado = (dados) => {
    const { vigencia_a: a, vigencia_b: b, variacoes, justificativas } = dados;

    // Tabela de indicadores
    const indicadorRows = variacoes.map((v) => {
      const label = INDICADOR_LABELS[v.campo] || v.campo;
      return `
        <tr class="comp-table-row">
          <td class="comp-table-label">${label}</td>
          <td class="comp-table-val num">${formatarIndicador(v.campo, v.valor_a)}</td>
          <td class="comp-table-val num">${formatarIndicador(v.campo, v.valor_b)}</td>
          <td class="comp-table-delta">${renderVariacao(v)}</td>
        </tr>
      `;
    }).join('');

    // Composição de dias
    const compRows = renderComposicaoDias(a, b);

    // Justificativas
    const justHtml = justificativas.length > 0
      ? renderJustificativas(justificativas)
      : '';

    return `
      <div class="comp-header-pair">
        ${renderVigenciaHeader(a, 'A')}
        ${renderVigenciaHeader(b, 'B')}
      </div>

      <div class="card comp-table-card">
        <table class="comp-table">
          <thead>
            <tr>
              <th>Indicador</th>
              <th class="num">${window.Utils.escapeHtml(a.nome)}</th>
              <th class="num">${window.Utils.escapeHtml(b.nome)}</th>
              <th>Variação</th>
            </tr>
          </thead>
          <tbody>
            ${indicadorRows}
          </tbody>
        </table>
      </div>

      <div class="card comp-table-card">
        <div class="comp-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18"/>
            <path d="M9 21V9"/>
          </svg>
          Composição de Dias
        </div>
        <table class="comp-table">
          <thead>
            <tr>
              <th>Dia da Semana</th>
              <th class="num">${window.Utils.escapeHtml(a.nome)}</th>
              <th class="num">${window.Utils.escapeHtml(b.nome)}</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            ${compRows}
          </tbody>
        </table>
      </div>

      ${justHtml}
    `;
  };

  /**
   * Renderiza o cabeçalho de uma vigência no par.
   *
   * @param {Object} vig  - VigenciaIndicadores.
   * @param {string} side - "A" ou "B".
   * @returns {string} HTML.
   */
  const renderVigenciaHeader = (vig, side) => `
    <div class="comp-vig-header comp-vig-header--${side.toLowerCase()}">
      <div class="comp-vig-badge">${side}</div>
      <div class="comp-vig-info">
        <div class="comp-vig-name">${window.Utils.escapeHtml(vig.nome)}</div>
        <div class="comp-vig-period">${vig.periodo}</div>
      </div>
      <div class="comp-vig-teto">${window.Utils.formatarMoeda(vig.teto_valor)}</div>
    </div>
  `;

  /**
   * Renderiza as linhas de composição de dias.
   *
   * @param {Object} a - VigenciaIndicadores A.
   * @param {Object} b - VigenciaIndicadores B.
   * @returns {string} HTML das <tr>.
   */
  const renderComposicaoDias = (a, b) => {
    const diasLabel = {
      segunda: 'Segunda',
      'terça': 'Terça',
      quarta: 'Quarta',
      quinta: 'Quinta',
      sexta: 'Sexta',
      'sábado': 'Sábado',
      domingo: 'Domingo',
    };

    return Object.entries(diasLabel).map(([key, label]) => {
      const qA = a.composicao[key] || 0;
      const qB = b.composicao[key] || 0;
      const diff = qB - qA;

      let diffHtml = '<span class="comp-delta comp-delta--equal">—</span>';
      if (diff > 0) {
        diffHtml = `<span class="comp-delta comp-delta--up">↑ +${diff}</span>`;
      } else if (diff < 0) {
        diffHtml = `<span class="comp-delta comp-delta--down">↓ ${diff}</span>`;
      }

      return `
        <tr class="comp-table-row">
          <td class="comp-table-label">${label}</td>
          <td class="comp-table-val num">${qA}</td>
          <td class="comp-table-val num">${qB}</td>
          <td class="comp-table-delta">${diffHtml}</td>
        </tr>
      `;
    }).join('');
  };

  /**
   * Renderiza as justificativas automáticas.
   *
   * @param {Object[]} justificativas - Lista de justificativas.
   * @returns {string} HTML.
   */
  const renderJustificativas = (justificativas) => {
    const items = justificativas.map((j) => {
      const impactoClass = j.impacto > 0
        ? 'comp-just-up'
        : (j.impacto < 0 ? 'comp-just-down' : '');

      const impactoStr = j.impacto !== 0
        ? `<span class="comp-just-impacto ${impactoClass}">${j.impacto > 0 ? '+' : ''}${window.Utils.formatarMoeda(j.impacto)}</span>`
        : '';

      return `
        <div class="comp-just-item">
          <span class="comp-just-dot"></span>
          <span class="comp-just-text">${window.Utils.escapeHtml(j.texto)}</span>
          ${impactoStr}
        </div>
      `;
    }).join('');

    return `
      <div class="card comp-just-card">
        <div class="comp-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
          Justificativas
        </div>
        <div class="comp-just-list">
          ${items}
        </div>
      </div>
    `;
  };

  // ─── Data fetching ─────────────────────────────────────

  /**
   * Executa a comparação chamando o backend.
   *
   * @returns {Promise<void>}
   */
  const executarComparacao = async () => {
    const resultEl = document.getElementById('compResult');
    if (!resultEl) return;

    resultEl.innerHTML = '<div class="prev-loading"><span class="spinner"></span> Comparando vigências...</div>';

    const result = await window.Api.request('comparar_vigencias', {
      ano_a: state.anoA,
      mes_a: state.mesA,
      ano_b: state.anoB,
      mes_b: state.mesB,
    });

    if (!result.ok) {
      resultEl.innerHTML = `<div class="prev-error">${window.Utils.escapeHtml(result.error || 'Erro ao comparar.')}</div>`;
      return;
    }

    state.resultado = result.data;
    resultEl.innerHTML = renderResultado(result.data);
  };

  // ─── Event bindings ────────────────────────────────────

  /**
   * Vincula eventos da tela de comparação.
   *
   * @returns {void}
   */
  const bindEvents = () => {
    const mesA = document.getElementById('compMesA');
    const anoA = document.getElementById('compAnoA');
    const mesB = document.getElementById('compMesB');
    const anoB = document.getElementById('compAnoB');
    const execBtn = document.getElementById('compExecuteBtn');

    if (mesA) mesA.addEventListener('change', (e) => { state.mesA = Number(e.target.value); });
    if (anoA) anoA.addEventListener('change', (e) => { state.anoA = Number(e.target.value); });
    if (mesB) mesB.addEventListener('change', (e) => { state.mesB = Number(e.target.value); });
    if (anoB) anoB.addEventListener('change', (e) => { state.anoB = Number(e.target.value); });

    if (execBtn) {
      execBtn.addEventListener('click', () => {
        if (state.anoA === state.anoB && state.mesA === state.mesB) {
          window.UI.showToast('Selecione vigências diferentes para comparar.', 'warning');
          return;
        }
        executarComparacao();
      });
    }
  };

  // ─── Exports ───────────────────────────────────────────

  window.Comparacao = { render };
})();
