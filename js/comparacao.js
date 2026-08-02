/**
 * ═══════════════════════════════════════════════════════════
 *  comparacao.js — Comparação entre vigências
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Seleção de duas vigências (automática: atual vs anterior)
 *  - Tabela comparativa com todos os indicadores
 *  - Setas e variação percentual
 *  - Detecção e exibição de alterações na relação de plantões
 *  - Justificativas automáticas em formato de parágrafo
 *  - Botão de copiar justificativa
 *  - Botão de download PDF/XLSX da comparação
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

  /** @type {Object<string, string>} */
  const INDICADOR_LABELS = {
    total_dias: 'Total de Dias',
    dias_uteis: 'Dias Úteis',
    dias_fds: 'Fins de Semana',
    dias_feriado: 'Feriados',
    total_horas: 'Total de Horas',
    teto_valor: 'Teto plantões (R$)',
    valor_realizado: 'Realizado/plantões (R$)',
    diferenca: 'Diferença/plantões (R$)',
    realizado_sos: 'Realizado/SOS (R$)',
    teto_sos: 'Teto SOS (R$)',
    teto_geral: 'Teto total (R$)',
    horas_sos: 'Horas de SOS',
  };

  /** @type {Set<string>} */
  const INDICADORES_MOEDA = new Set([
    'teto_valor', 'valor_realizado', 'diferenca',
    'realizado_sos', 'teto_sos', 'teto_geral',
  ]);

  /** @type {Set<string>} */
  const INDICADORES_HORAS = new Set(['total_horas', 'horas_sos']);

  /** @type {Object<string, string>} */
  const DIAS_LABEL = {
    segunda: 'Segunda',
    'terça': 'Terça',
    quarta: 'Quarta',
    quinta: 'Quinta',
    sexta: 'Sexta',
    'sábado': 'Sábado',
    domingo: 'Domingo',
  };

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * @param {number} ano
   * @param {number} mes
   * @returns {{ ano: number, mes: number }}
   */
  const vigenciaAnterior = (ano, mes) => {
    if (mes <= 1) return { ano: ano - 1, mes: 12 };
    return { ano, mes: mes - 1 };
  };

  /**
   * @param {string} campo
   * @param {number} valor
   * @returns {string}
   */
  const formatarIndicador = (campo, valor) => {
    if (INDICADORES_MOEDA.has(campo)) return window.Utils.formatarMoeda(valor);
    if (INDICADORES_HORAS.has(campo)) return `${valor.toLocaleString('pt-BR')}h`;
    return String(valor);
  };

  /**
   * @param {Object} variacao
   * @returns {string}
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
   * @param {number[]} anos
   * @param {number}   [anoAtual]
   * @param {number}   [mesAtual]
   */
  const render = (anos, anoAtual, mesAtual) => {
    state.anos = anos;

    const agora = new Date();
    const anoRef = anoAtual || agora.getFullYear();
    const mesRef = mesAtual || agora.getMonth() + 1;

    state.anoB = anoRef;
    state.mesB = isPreInicio(anoRef, mesRef)
      ? primeiroMesHabilitado(anoRef)
      : mesRef;
    const ant = vigenciaAnterior(anoRef, state.mesB);
    state.anoA = ant.ano;
    state.mesA = isPreInicio(ant.ano, ant.mes)
      ? primeiroMesHabilitado(ant.ano)
      : ant.mes;

    const mainBody = document.getElementById('mainBody');
    if (!mainBody) return;

    const titleEl = document.getElementById('mainHeaderTitle');
    const subtitleEl = document.getElementById('mainHeaderSubtitle');
    if (titleEl) titleEl.textContent = 'Comparação de Vigências';
    if (subtitleEl) subtitleEl.textContent = 'Análise lado a lado de indicadores';

    mainBody.innerHTML = renderShell();
    bindEvents();
    executarComparacao();
  };

  /**
   * @returns {string}
   */
  const renderShell = () => {
    const optionsAnoA = renderAnoOptions(state.anoA);
    const optionsAnoB = renderAnoOptions(state.anoB);
    const optionsMesA = renderMesOptions(state.mesA, state.anoA);
    const optionsMesB = renderMesOptions(state.mesB, state.anoB);

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

        <div class="comp-result" id="compResult"></div>
      </div>
    `;
  };

  /** @param {number} selected */
  const renderAnoOptions = (selected) => state.anos
    .map((a) => `<option value="${a}"${a === selected ? ' selected' : ''}>${a}</option>`)
    .join('');

  /**
   * Verifica se uma vigência é anterior ao início de operação do sistema.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {boolean} true se pré-operação.
   */
  const isPreInicio = (ano, mes) => (
    ano === window.AppConfig.ANO_INICIO_SISTEMA
    && mes < window.AppConfig.MES_INICIO_SISTEMA
  );

  /**
   * @param {number} selected - Mês selecionado.
   * @param {number} ano - Ano ativo (para filtrar meses pré-operação).
   */
  const renderMesOptions = (selected, ano) => window.AppConfig.MESES
    .filter((_, i) => !isPreInicio(ano, i + 1))
    .map((nome, _, arr) => {
      const mes = window.AppConfig.MESES.indexOf(nome) + 1;
      return `<option value="${mes}"${mes === selected ? ' selected' : ''}>${nome}</option>`;
    })
    .join('');

  // ─── Render: Resultado ────────────────────────────────

  /**
   * @param {Object} dados
   * @returns {string}
   */
  const renderResultado = (dados) => {
    const { vigencia_a: a, vigencia_b: b, variacoes, justificativas } = dados;
    const { alteracoes_relacao, justificativa_texto } = dados;

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

    // Alterações na relação
    const altRelacaoHtml = alteracoes_relacao && alteracoes_relacao.length > 0
      ? renderAlteracoesRelacao(alteracoes_relacao, dados.impacto_relacao, b.nome)
      : '';

    // Justificativa em parágrafo
    const justTextoHtml = justificativa_texto
      ? renderJustificativaTexto(justificativa_texto)
      : '';

    // Justificativas em itens (mantidas como detalhamento)
    const justItemsHtml = justificativas.length > 0
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

      ${altRelacaoHtml}
      ${justTextoHtml}
      ${justItemsHtml}

      <div class="comp-actions">
        <button type="button" class="btn btn--sm btn--ghost" id="compDownloadBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Comparação
        </button>
      </div>
    `;
  };

  /**
   * @param {Object} vig
   * @param {string} side
   * @returns {string}
   */
  const renderVigenciaHeader = (vig, side) => {
    const semDados = !vig.tem_dados
      ? '<span class="comp-vig-sem-dados">Sem dados de relação</span>'
      : '';

    return `
      <div class="comp-vig-header comp-vig-header--${side.toLowerCase()}">
        <div class="comp-vig-badge">${side}</div>
        <div class="comp-vig-info">
          <div class="comp-vig-name">${window.Utils.escapeHtml(vig.nome)}</div>
          <div class="comp-vig-period">${vig.periodo}</div>
          ${semDados}
        </div>
        <div class="comp-vig-teto">${window.Utils.formatarMoeda(vig.teto_geral || vig.teto_valor)}</div>
      </div>
    `;
  };

  /**
   * @param {Object} a
   * @param {Object} b
   * @returns {string}
   */
  const renderComposicaoDias = (a, b) => Object.entries(DIAS_LABEL).map(([key, label]) => {
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

  // ─── Render: Alterações na relação ────────────────────

  /**
   * @param {Object[]} alteracoes
   * @param {number}   impactoTotal
   * @param {string}   nomeVigB
   * @returns {string}
   */
  const renderAlteracoesRelacao = (alteracoes, impactoTotal, nomeVigB) => {
    const rows = alteracoes.map((alt) => {
      const label = DIAS_LABEL[alt.dia_semana] || alt.dia_semana;
      const diffH = alt.diferenca_horas;
      const cls = diffH > 0 ? 'comp-delta--up' : 'comp-delta--down';
      const sinal = diffH > 0 ? '+' : '';

      return `
        <tr class="comp-table-row comp-table-row--highlight">
          <td class="comp-table-label">${label}</td>
          <td class="comp-table-val num">${alt.horas_antes}h</td>
          <td class="comp-table-val num">${alt.horas_depois}h</td>
          <td class="comp-table-delta">
            <span class="comp-delta ${cls}">${sinal}${diffH}h</span>
          </td>
        </tr>
      `;
    }).join('');

    const impCls = impactoTotal > 0 ? 'comp-just-up' : 'comp-just-down';
    const impSinal = impactoTotal > 0 ? '+' : '';

    return `
      <div class="card comp-table-card comp-alt-card">
        <div class="comp-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
          Alterações na Relação de Plantões
        </div>
        <table class="comp-table">
          <thead>
            <tr>
              <th>Dia da Semana</th>
              <th class="num">Antes</th>
              <th class="num">Depois</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="comp-alt-impacto">
          Impacto estimado em ${window.Utils.escapeHtml(nomeVigB)}:
          <span class="${impCls}">${impSinal}${window.Utils.formatarMoeda(impactoTotal)}</span>
        </div>
      </div>
    `;
  };

  // ─── Render: Justificativa em parágrafo ────────────────

  /**
   * @param {string} texto
   * @returns {string}
   */
  const renderJustificativaTexto = (texto) => {
    const paragrafos = texto.split('\n\n').map(
      (p) => `<p class="comp-just-paragraph">${window.Utils.escapeHtml(p)}</p>`,
    ).join('');

    return `
      <div class="card comp-just-texto-card">
        <div class="comp-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Justificativa
          <button type="button" class="btn btn--xs btn--ghost comp-copy-btn" id="compCopyJust" title="Copiar justificativa">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copiar
          </button>
        </div>
        <div class="comp-just-texto-body" id="compJustTextoBody">
          ${paragrafos}
        </div>
      </div>
    `;
  };

  // ─── Render: Justificativas em itens ───────────────────

  /**
   * @param {Object[]} justificativas
   * @returns {string}
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
          Detalhamento por Fator
        </div>
        <div class="comp-just-list">
          ${items}
        </div>
      </div>
    `;
  };

  // ─── Data fetching ─────────────────────────────────────

  /** @returns {Promise<void>} */
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
    bindResultEvents();
  };

  // ─── Download da comparação ────────────────────────────

  /**
   * Gera e baixa um CSV com os dados da comparação.
   */
  const downloadComparacao = () => {
    const d = state.resultado;
    if (!d) return;

    const a = d.vigencia_a;
    const b = d.vigencia_b;

    /** @type {string[][]} */
    const rows = [];
    const sep = ';';

    rows.push(['Comparação de Vigências']);
    rows.push([a.nome + ' (' + a.periodo + ')', '', b.nome + ' (' + b.periodo + ')']);
    rows.push([]);

    rows.push(['Indicador', a.nome, b.nome, 'Variação', 'Variação %']);
    d.variacoes.forEach((v) => {
      const label = INDICADOR_LABELS[v.campo] || v.campo;
      rows.push([label, String(v.valor_a), String(v.valor_b), String(v.delta), `${v.delta_pct}%`]);
    });

    rows.push([]);
    rows.push(['Composição de Dias', a.nome, b.nome, 'Diferença']);
    Object.entries(DIAS_LABEL).forEach(([key, label]) => {
      const qA = a.composicao[key] || 0;
      const qB = b.composicao[key] || 0;
      rows.push([label, String(qA), String(qB), String(qB - qA)]);
    });

    if (d.alteracoes_relacao && d.alteracoes_relacao.length > 0) {
      rows.push([]);
      rows.push(['Alterações na Relação de Plantões', 'Antes', 'Depois', 'Diferença']);
      d.alteracoes_relacao.forEach((alt) => {
        const label = DIAS_LABEL[alt.dia_semana] || alt.dia_semana;
        rows.push([label, `${alt.horas_antes}h`, `${alt.horas_depois}h`, `${alt.diferenca_horas}h`]);
      });
      rows.push(['Impacto estimado', '', '', `R$ ${d.impacto_relacao}`]);
    }

    if (d.justificativa_texto) {
      rows.push([]);
      rows.push(['Justificativa']);
      rows.push([d.justificativa_texto.replace(/\n\n/g, ' ')]);
    }

    // BOM para UTF-8
    const bom = '\uFEFF';
    const csv = bom + rows.map((r) => r.join(sep)).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `comparacao_${a.id}_vs_${b.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.UI.showToast('Download concluído.', 'success');
  };

  // ─── Copiar justificativa ─────────────────────────────

  const copiarJustificativa = async () => {
    const d = state.resultado;
    if (!d || !d.justificativa_texto) return;

    try {
      await navigator.clipboard.writeText(d.justificativa_texto);
      window.UI.showToast('Justificativa copiada!', 'success');
    } catch (_) {
      // Fallback para browsers sem Clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = d.justificativa_texto;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        window.UI.showToast('Justificativa copiada!', 'success');
      } catch (__) {
        window.UI.showToast('Não foi possível copiar. Selecione manualmente.', 'error');
      }
      document.body.removeChild(textarea);
    }
  };

  // ─── Event bindings ────────────────────────────────────

  /**
   * Retorna o primeiro mês habilitado para um dado ano.
   *
   * @param {number} ano
   * @returns {number} Mês (1–12).
   */
  const primeiroMesHabilitado = (ano) => {
    if (ano === window.AppConfig.ANO_INICIO_SISTEMA) {
      return window.AppConfig.MES_INICIO_SISTEMA;
    }
    return 1;
  };

  /**
   * Atualiza as options de um <select> de mês ao trocar o ano.
   * Se o mês selecionado ficar inválido (pré-operação), ajusta para o
   * primeiro mês habilitado.
   *
   * @param {HTMLSelectElement} selectEl - Select de mês.
   * @param {number} ano - Ano recém-selecionado.
   * @param {'A'|'B'} lado - Lado da comparação.
   */
  const atualizarMesesPorAno = (selectEl, ano, lado) => {
    const mesAtual = lado === 'A' ? state.mesA : state.mesB;
    const mesAjustado = isPreInicio(ano, mesAtual)
      ? primeiroMesHabilitado(ano)
      : mesAtual;

    selectEl.innerHTML = renderMesOptions(mesAjustado, ano);

    if (lado === 'A') {
      state.mesA = mesAjustado;
    } else {
      state.mesB = mesAjustado;
    }
  };

  const bindEvents = () => {
    const mesA = document.getElementById('compMesA');
    const anoA = document.getElementById('compAnoA');
    const mesB = document.getElementById('compMesB');
    const anoB = document.getElementById('compAnoB');
    const execBtn = document.getElementById('compExecuteBtn');

    if (mesA) mesA.addEventListener('change', (e) => { state.mesA = Number(e.target.value); });
    if (mesB) mesB.addEventListener('change', (e) => { state.mesB = Number(e.target.value); });

    if (anoA) {
      anoA.addEventListener('change', (e) => {
        state.anoA = Number(e.target.value);
        if (mesA) atualizarMesesPorAno(mesA, state.anoA, 'A');
      });
    }

    if (anoB) {
      anoB.addEventListener('change', (e) => {
        state.anoB = Number(e.target.value);
        if (mesB) atualizarMesesPorAno(mesB, state.anoB, 'B');
      });
    }

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

  const bindResultEvents = () => {
    const copyBtn = document.getElementById('compCopyJust');
    if (copyBtn) {
      copyBtn.addEventListener('click', copiarJustificativa);
    }

    const downloadBtn = document.getElementById('compDownloadBtn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadComparacao);
    }
  };

  // ─── Exports ───────────────────────────────────────────

  window.Comparacao = { render };
})();
