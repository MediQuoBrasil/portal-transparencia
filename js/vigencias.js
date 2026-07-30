/**
 * ═══════════════════════════════════════════════════════════
 *  vigencias.js — Navegação, upload e exibição de vigências
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *  - Navegação por anos/meses na sidebar
 *  - Upload de planilha FinanceiroEntradaSaida (.xlsx)
 *  - Parsing client-side (SheetJS) e envio ao backend
 *  - Preview: métricas, profissionais, botões de download
 *  - Download dos 3 relatórios (delega para Relatorios)
 */

(function () {
  'use strict';

  // ─── Typedefs ────────────────────────────────────────────

  /**
   * @typedef {Object} VigenciaState
   * @property {number[]}  anos            - Anos disponíveis
   * @property {number}    anoAtivo        - Ano selecionado
   * @property {number}    mesAtivo        - Mês selecionado (1–12)
   * @property {Object[]}  vigencias       - Vigências do ano ativo
   * @property {Object|null} dadosRelatorio - Dados parseados da vigência ativa
   */

  /** @type {VigenciaState} */
  const state = {
    anos: [],
    anoAtivo: 0,
    mesAtivo: 0,
    vigencias: [],
    dadosRelatorio: null,
  };

  // ─── Tooltip ─────────────────────────────────────────────

  /**
   * Calcula as datas de início e fim para tooltip.
   * Vigência do mês M/AAAA: 21/(M-1) até 20/M.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {string} "DD/MM/AAAA a DD/MM/AAAA".
   */
  const tooltipVigencia = (ano, mes) => {
    const pad = (n) => String(n).padStart(2, '0');
    let iniMes;
    let iniAno;

    if (mes === 1) {
      iniMes = 12;
      iniAno = ano - 1;
    } else {
      iniMes = mes - 1;
      iniAno = ano;
    }

    return `${pad(21)}/${pad(iniMes)}/${iniAno} a ${pad(20)}/${pad(mes)}/${ano}`;
  };

  /**
   * Retorna as datas de início e fim de uma vigência como objeto.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {{ inicio: string, fim: string }}
   */
  const datasVigencia = (ano, mes) => {
    const pad = (n) => String(n).padStart(2, '0');
    let iniMes;
    let iniAno;

    if (mes === 1) {
      iniMes = 12;
      iniAno = ano - 1;
    } else {
      iniMes = mes - 1;
      iniAno = ano;
    }

    return {
      inicio: `${pad(21)}/${pad(iniMes)}/${iniAno}`,
      fim: `${pad(20)}/${pad(mes)}/${ano}`,
    };
  };

  // ─── Sidebar: Anos ──────────────────────────────────────

  /**
   * Renderiza os botões de ano na sidebar.
   */
  const renderAnos = () => {
    const container = document.getElementById('yearSelector');
    if (!container) return;

    container.innerHTML = '';

    state.anos.forEach((ano) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `year-btn${ano === state.anoAtivo ? ' active' : ''}`;
      btn.textContent = String(ano);
      btn.addEventListener('click', () => { selecionarAno(ano); });
      container.appendChild(btn);
    });

    // Botão "+" (admin only)
    const userRole = window.Auth.getSession()?.role;
    if (userRole === 'admin') {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'year-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Criar próximo ano';
      addBtn.addEventListener('click', criarProximoAno);
      container.appendChild(addBtn);
    }
  };

  // ─── Sidebar: Meses ─────────────────────────────────────

  /**
   * Renderiza a lista de meses na sidebar.
   */
  const renderMeses = () => {
    const list = document.getElementById('monthList');
    if (!list) return;

    list.innerHTML = '';

    state.vigencias.forEach((v) => {
      const li = document.createElement('li');
      li.className = 'month-item'
        + (v.mes === state.mesAtivo ? ' active' : '')
        + (v.status !== 'pendente' ? ' has-data' : '');

      const dot = document.createElement('span');
      dot.className = 'month-dot';

      const content = document.createElement('span');
      content.className = 'month-content';

      const label = document.createElement('span');
      label.className = 'month-name';
      label.textContent = v.nome;

      const vigencia = document.createElement('span');
      vigencia.className = 'month-vigencia';
      vigencia.textContent = tooltipVigencia(state.anoAtivo, v.mes);

      content.appendChild(label);
      content.appendChild(vigencia);
      li.appendChild(dot);
      li.appendChild(content);

      li.addEventListener('click', () => { selecionarMes(v.mes); });

      list.appendChild(li);
    });
  };

  // ─── Seleção de ano/mês ─────────────────────────────────

  /**
   * Carrega e seleciona um ano.
   * @param {number} ano - Ano a selecionar.
   */
  const selecionarAno = async (ano) => {
    state.anoAtivo = ano;
    renderAnos();

    window.UI.showLoading('Carregando vigências...');

    const result = await window.Api.request('listar_vigencias', { ano });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao carregar vigências.', 'error');
      return;
    }

    state.vigencias = result.data.vigencias || [];
    renderMeses();

    // Selecionar mês atual ou primeiro disponível
    const mesAtual = new Date().getMonth() + 1;
    const mesDefault = state.vigencias.find((v) => v.mes === mesAtual)
      ? mesAtual
      : (state.vigencias[0]?.mes || 1);

    selecionarMes(mesDefault);
  };

  /**
   * Seleciona um mês e carrega seus dados.
   * @param {number} mes - Mês (1–12).
   */
  const selecionarMes = async (mes) => {
    state.mesAtivo = mes;
    state.dadosRelatorio = null;
    renderMeses();

    // Fechar sidebar no mobile
    document.dispatchEvent(new CustomEvent('month-selected'));

    // Atualizar header
    const headerTitle = document.getElementById('mainHeaderTitle');
    const headerSubtitle = document.getElementById('mainHeaderSubtitle');
    const mesNome = window.AppConfig.MESES[mes - 1] || '';

    if (headerTitle) headerTitle.textContent = `${mesNome} ${state.anoAtivo}`;
    if (headerSubtitle) headerSubtitle.textContent = tooltipVigencia(state.anoAtivo, mes);

    await carregarDetalheVigencia(state.anoAtivo, mes);
  };

  // ─── Carregar detalhe ───────────────────────────────────

  /**
   * Carrega e exibe o conteúdo de uma vigência específica.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês.
   */
  const carregarDetalheVigencia = async (ano, mes) => {
    const mainBody = document.getElementById('mainBody');
    if (!mainBody) return;

    window.UI.showLoading('Carregando dados da vigência...');

    const result = await window.Api.request('detalhe_vigencia', { ano, mes });

    window.UI.hideLoading();

    if (!result.ok) {
      mainBody.innerHTML = renderPlaceholder(
        'alert-triangle',
        'Erro ao carregar',
        result.error || 'Não foi possível carregar os dados desta vigência.',
      );
      return;
    }

    const vigencia = result.data;

    if (!vigencia.temDados) {
      // Verificar permissão para upload
      const session = window.Auth.getSession();
      const podeUpload = session && (session.role === 'admin' || session.role === 'gestor');

      if (podeUpload) {
        mainBody.innerHTML = renderUploadZone(vigencia);
        bindUploadEvents();
      } else {
        mainBody.innerHTML = renderPlaceholder(
          'file-x',
          'Nenhum dado importado',
          `A vigência de ${vigencia.nome} ainda não possui dados.`,
        );
      }
      return;
    }

    // Reconstruir DadosRelatorio a partir dos dados persistidos
    const datas = datasVigencia(ano, mes);
    state.dadosRelatorio = window.Relatorios.reconstruirDados(
      { inicio: datas.inicio, fim: datas.fim },
      vigencia.registros,
    );

    mainBody.innerHTML = renderPreview(state.dadosRelatorio, vigencia);
    bindPreviewEvents();
  };

  // ─── Upload Zone ────────────────────────────────────────

  /**
   * Renderiza a zona de upload para vigências sem dados.
   *
   * @param {Object} vigencia - Info da vigência do backend.
   * @returns {string} HTML.
   */
  const renderUploadZone = (vigencia) => `
    <div class="card upload-card">
      <div class="upload-zone" id="uploadZone">
        <div class="upload-zone-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
               stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="upload-zone-label">Arraste o arquivo .xlsx aqui</div>
        <div class="upload-zone-sublabel">
          ou <span class="upload-zone-link" id="uploadBtn">clique para selecionar</span>
        </div>
        <div class="upload-zone-hint">Planilha FinanceiroEntradaSaida — ${window.Utils.escapeHtml(vigencia.nome)}</div>
        <input type="file" id="fileInput" accept=".xlsx,.xls" class="hidden">
      </div>

      <div class="upload-feedback" id="uploadFeedback"></div>
    </div>
  `;

  /**
   * Vincula eventos de drag-and-drop e seleção de arquivo.
   */
  const bindUploadEvents = () => {
    const zone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (!zone || !fileInput) return;

    if (uploadBtn) {
      uploadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    zone.addEventListener('click', () => { fileInput.click(); });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        processarArquivo(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        processarArquivo(fileInput.files[0]);
      }
    });
  };

  // ─── Processamento de arquivo ───────────────────────────

  /**
   * Lê e parseia o arquivo .xlsx, envia dados ao backend.
   *
   * @param {File} file - Arquivo selecionado pelo usuário.
   */
  const processarArquivo = (file) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      showUploadFeedback('Por favor, envie um arquivo .xlsx válido.', 'error');
      return;
    }

    showUploadFeedback('Lendo arquivo...', 'info');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', raw: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

        const dados = window.Relatorios.parsearPlanilha(rows);

        if (dados.profissionais.length === 0) {
          showUploadFeedback('Nenhum profissional detectado na planilha. Verifique o formato.', 'error');
          return;
        }

        showUploadFeedback('Enviando dados ao servidor...', 'info');

        // Serializar e enviar ao backend
        const registros = window.Relatorios.serializarParaBackend(dados);

        const result = await window.Api.request('upload_vigencia', {
          ano: state.anoAtivo,
          mes: state.mesAtivo,
          registros,
        });

        if (!result.ok) {
          showUploadFeedback(result.error || 'Erro ao salvar dados.', 'error');
          return;
        }

        // Atualizar status na sidebar
        const vigIdx = state.vigencias.findIndex((v) => v.mes === state.mesAtivo);
        if (vigIdx !== -1) {
          state.vigencias[vigIdx].status = 'ativa';
        }
        renderMeses();

        // Exibir preview com dados parseados
        state.dadosRelatorio = dados;
        const mainBody = document.getElementById('mainBody');
        if (mainBody) {
          mainBody.innerHTML = renderPreview(dados);
          bindPreviewEvents();
        }

        window.UI.showToast('Dados importados com sucesso!', 'success');
      } catch (err) {
        console.error('[Vigencias] Erro ao processar arquivo:', err);
        showUploadFeedback(`Erro ao processar o arquivo: ${err.message}`, 'error');
      }
    };

    reader.readAsArrayBuffer(file);
  };

  /**
   * Exibe feedback na zona de upload.
   *
   * @param {string} msg - Mensagem.
   * @param {'info'|'success'|'error'} tipo - Tipo do feedback.
   */
  const showUploadFeedback = (msg, tipo) => {
    const el = document.getElementById('uploadFeedback');
    if (!el) return;

    el.className = `upload-feedback ${tipo}`;
    const icons = { info: '', success: '✓', error: '✕' };
    const icon = tipo === 'info'
      ? '<span class="spinner"></span>'
      : `<span class="upload-feedback-icon">${icons[tipo]}</span>`;
    el.innerHTML = `${icon}<span>${window.Utils.escapeHtml(msg)}</span>`;
  };

  // ─── Preview ────────────────────────────────────────────

  /** @type {'alfa'|'horas'} */
  let sortMode = 'alfa';

  /**
   * Gera o HTML de uma linha de profissional na tabela.
   *
   * @param {Profissional} p - Profissional.
   * @param {string} horasPct - Porcentagem de horas já formatada.
   * @param {string} valorPct - Porcentagem de valor já formatada.
   * @returns {string} HTML da linha (tr).
   */
  const renderProfRow = (p, horasPct, valorPct) => {
    const nome = window.Utils.escapeHtml(p.nome);
    const crm = window.Utils.escapeHtml(p.crm);
    const horas = window.Utils.formatarTotalHoras(p.totalHoras);
    const valor = window.Utils.formatarMoeda(p.totalValor);

    return `
      <tr class="prof-row">
        <td class="prof-cell-name"><span class="prof-dot"></span>${nome}</td>
        <td class="prof-cell-crm">${crm}</td>
        <td class="prof-cell-metric"><span class="prof-metric-val">${horas}</span><span class="prof-pct">${horasPct}</span></td>
        <td class="prof-cell-metric prof-cell-valor"><span class="prof-metric-val">${valor}</span><span class="prof-pct">${valorPct}</span></td>
      </tr>
    `;
  };

  /**
   * Ordena e re-renderiza apenas a tabela de profissionais.
   *
   * @param {Object} dados - DadosRelatorio.
   */
  const reorderProfList = (dados) => {
    const tbody = document.getElementById('profTbody');
    if (!tbody) return;

    const sorted = [...dados.profissionais];

    if (sortMode === 'horas') {
      sorted.sort((a, b) => b.totalHoras - a.totalHoras || b.totalValor - a.totalValor);
    } else {
      sorted.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }

    const horasPcts = window.Utils.distribuirPorcentagens(
      sorted.map((p) => p.totalHoras),
      dados.totalGeral.horas,
    );
    const valorPcts = window.Utils.distribuirPorcentagens(
      sorted.map((p) => p.totalValor),
      dados.totalGeral.valor,
    );

    tbody.innerHTML = sorted
      .map((p, i) => renderProfRow(p, horasPcts[i], valorPcts[i]))
      .join('');

    // Atualizar estado visual dos botões
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sort === sortMode);
    });
  };

  /**
   * Renderiza o preview completo: métricas, profissionais, botões de download.
   *
   * @param {Object} dados - DadosRelatorio.
   * @param {Object} [vigenciaInfo] - Info extra do backend (para botão remover).
   * @returns {string} HTML.
   */
  const renderPreview = (dados, vigenciaInfo) => {
    const session = window.Auth.getSession();
    const podeRemover = session && session.role === 'admin';

    const sorted = [...dados.profissionais];
    if (sortMode === 'horas') {
      sorted.sort((a, b) => b.totalHoras - a.totalHoras || b.totalValor - a.totalValor);
    } else {
      sorted.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }

    const horasPcts = window.Utils.distribuirPorcentagens(
      sorted.map((p) => p.totalHoras),
      dados.totalGeral.horas,
    );
    const valorPcts = window.Utils.distribuirPorcentagens(
      sorted.map((p) => p.totalValor),
      dados.totalGeral.valor,
    );

    const profRowsHtml = sorted
      .map((p, i) => renderProfRow(p, horasPcts[i], valorPcts[i]))
      .join('');

    return `
      <div class="card">
        <div class="card-title">Resumo da vigência</div>
        <div class="metrics metrics--4col">
          <div class="metric-box">
            <div class="value">${dados.vigencia.curta}</div>
            <div class="label">Vigência</div>
          </div>
          <div class="metric-box">
            <div class="value">${dados.profissionais.length}</div>
            <div class="label">Profissionais</div>
          </div>
          <div class="metric-box">
            <div class="value">${window.Utils.formatarTotalHoras(dados.totalGeral.horas)}</div>
            <div class="label">Horas totais</div>
          </div>
          <div class="metric-box">
            <div class="value">${window.Utils.formatarMoeda(dados.totalGeral.valor)}</div>
            <div class="label">Valor total</div>
          </div>
        </div>
      </div>

      <div class="card card--prof">
        <div class="card-header-row">
          <div class="card-title">Profissionais</div>
          <div class="sort-group" role="group" aria-label="Ordenação">
            <button type="button" class="sort-btn${sortMode === 'alfa' ? ' active' : ''}" data-sort="alfa" id="sortAlfa">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/><path d="M3 12h12"/><path d="M3 18h6"/>
              </svg>
              A–Z
            </button>
            <button type="button" class="sort-btn${sortMode === 'horas' ? ' active' : ''}" data-sort="horas" id="sortHoras">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>
              </svg>
              Maior carga
            </button>
          </div>
        </div>

        <div class="prof-table-wrap">
          <table class="prof-table">
            <thead>
              <tr>
                <th class="prof-th-name">Nome</th>
                <th class="prof-th-crm">CRM</th>
                <th class="prof-th-metric">Horas</th>
                <th class="prof-th-metric">Valor</th>
              </tr>
            </thead>
            <tbody id="profTbody">${profRowsHtml}</tbody>
          </table>
        </div>
      </div>

      <div class="actions-bar">
        <button class="btn btn-primary" id="btnDia" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          Relatório por Dia (.xlsx)
        </button>
        <button class="btn btn-primary" id="btnProf" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Relatório por Profissional (.xlsx)
        </button>
        <button class="btn btn-secondary" id="btnIndiv" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Relatórios Individuais (.zip)
        </button>
      </div>

      <div class="actions-feedback" id="actionsFeedback"></div>
      <div class="progress-bar-container" id="progressContainer">
        <div class="progress-bar" id="progressBar"></div>
      </div>

      ${podeRemover ? `
        <div class="danger-zone">
          <button class="btn btn-danger-ghost" id="btnRemover" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Remover dados desta vigência
          </button>
        </div>
      ` : ''}
    `;
  };

  /**
   * Vincula eventos dos botões de download e ação.
   */
  const bindPreviewEvents = () => {
    const btnDia = document.getElementById('btnDia');
    const btnProf = document.getElementById('btnProf');
    const btnIndiv = document.getElementById('btnIndiv');
    const btnRemover = document.getElementById('btnRemover');

    /** @type {RelatorioCallbacks} */
    const callbacks = {
      onFeedback: showActionsFeedback,
      onProgresso: atualizarProgresso,
      onProgressoFim: esconderProgresso,
      onBotoes: (habilitado) => {
        if (btnDia) btnDia.disabled = !habilitado;
        if (btnProf) btnProf.disabled = !habilitado;
        if (btnIndiv) btnIndiv.disabled = !habilitado;
      },
    };

    if (btnDia) {
      btnDia.addEventListener('click', () => {
        if (!state.dadosRelatorio) return;
        window.Relatorios.gerarRelatorioPorDia(state.dadosRelatorio, callbacks);
      });
    }

    if (btnProf) {
      btnProf.addEventListener('click', () => {
        if (!state.dadosRelatorio) return;
        window.Relatorios.gerarRelatorioPorProfissional(state.dadosRelatorio, callbacks);
      });
    }

    if (btnIndiv) {
      btnIndiv.addEventListener('click', () => {
        if (!state.dadosRelatorio) return;
        window.Relatorios.gerarRelatoriosIndividuais(state.dadosRelatorio, callbacks);
      });
    }

    if (btnRemover) {
      btnRemover.addEventListener('click', removerVigencia);
    }

    // Sort buttons
    const sortAlfa = document.getElementById('sortAlfa');
    const sortHoras = document.getElementById('sortHoras');

    if (sortAlfa) {
      sortAlfa.addEventListener('click', () => {
        sortMode = 'alfa';
        reorderProfList(state.dadosRelatorio);
      });
    }

    if (sortHoras) {
      sortHoras.addEventListener('click', () => {
        sortMode = 'horas';
        reorderProfList(state.dadosRelatorio);
      });
    }
  };

  // ─── Feedback e Progresso ───────────────────────────────

  /**
   * Exibe feedback abaixo dos botões de download.
   *
   * @param {string} msg - Mensagem.
   * @param {'info'|'success'|'error'} tipo - Tipo.
   */
  const showActionsFeedback = (msg, tipo) => {
    const el = document.getElementById('actionsFeedback');
    if (!el) return;

    el.className = `actions-feedback ${tipo}`;
    const icon = tipo === 'info'
      ? '<span class="spinner"></span>'
      : '';
    el.innerHTML = `${icon}<span>${window.Utils.escapeHtml(msg)}</span>`;
  };

  /**
   * Atualiza a barra de progresso.
   *
   * @param {number} atual - Valor atual.
   * @param {number} total - Valor total.
   */
  const atualizarProgresso = (atual, total) => {
    const container = document.getElementById('progressContainer');
    const bar = document.getElementById('progressBar');
    if (container) container.style.display = 'block';
    if (bar) bar.style.width = `${Math.round((atual / total) * 100)}%`;
  };

  /**
   * Esconde a barra de progresso.
   */
  const esconderProgresso = () => {
    const container = document.getElementById('progressContainer');
    const bar = document.getElementById('progressBar');
    if (container) container.style.display = 'none';
    if (bar) bar.style.width = '0%';
  };

  // ─── Remover vigência ───────────────────────────────────

  /**
   * Remove os dados de uma vigência (admin only).
   */
  const removerVigencia = async () => {
    if (!confirm('Tem certeza que deseja remover todos os dados desta vigência? Esta ação não pode ser desfeita.')) {
      return;
    }

    window.UI.showLoading('Removendo dados...');

    const result = await window.Api.request('remover_vigencia', {
      ano: state.anoAtivo,
      mes: state.mesAtivo,
    });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao remover dados.', 'error');
      return;
    }

    // Atualizar status na sidebar
    const vigIdx = state.vigencias.findIndex((v) => v.mes === state.mesAtivo);
    if (vigIdx !== -1) {
      state.vigencias[vigIdx].status = 'pendente';
    }
    renderMeses();

    state.dadosRelatorio = null;
    window.UI.showToast('Dados removidos com sucesso.', 'success');

    // Recarregar detalhe (vai exibir upload zone)
    await carregarDetalheVigencia(state.anoAtivo, state.mesAtivo);
  };

  // ─── Criar ano ──────────────────────────────────────────

  /**
   * Cria o próximo ano automaticamente.
   */
  const criarProximoAno = async () => {
    const proximoAno = state.anos.length > 0
      ? Math.max(...state.anos) + 1
      : new Date().getFullYear();

    if (!confirm(`Criar as vigências para o ano ${proximoAno}?`)) return;

    window.UI.showLoading(`Criando ano ${proximoAno}...`);

    const result = await window.Api.request('criar_ano', { ano: proximoAno });

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao criar ano.', 'error');
      return;
    }

    state.anos.push(proximoAno);
    state.anos.sort((a, b) => a - b);

    window.UI.showToast(`Ano ${proximoAno} criado com sucesso!`, 'success');

    selecionarAno(proximoAno);
  };

  // ─── Placeholder ────────────────────────────────────────

  /**
   * Renderiza um placeholder centralizado.
   *
   * @param {string} iconName - Nome do ícone Lucide.
   * @param {string} title - Título.
   * @param {string} text - Texto descritivo.
   * @returns {string} HTML.
   */
  const renderPlaceholder = (iconName, title, text) => {
    /** @type {Object<string, string>} */
    const icons = {
      'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      'file-x': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9.5" y1="12.5" x2="14.5" y2="17.5"/><line x1="14.5" y1="12.5" x2="9.5" y2="17.5"/>',
      'layout-dashboard': '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    };

    const svgInner = icons[iconName] || icons['layout-dashboard'];

    return `
      <div class="card placeholder-card">
        <div class="vigencia-placeholder">
          <div class="vigencia-placeholder-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                 stroke-linejoin="round">${svgInner}</svg>
          </div>
          <div class="vigencia-placeholder-title">${window.Utils.escapeHtml(title)}</div>
          <div class="vigencia-placeholder-text">${window.Utils.escapeHtml(text)}</div>
        </div>
      </div>
    `;
  };

  // ─── Init ───────────────────────────────────────────────

  /**
   * Carrega anos e inicializa a navegação.
   */
  const init = async () => {
    window.UI.showLoading('Carregando painel...');

    const result = await window.Api.request('listar_anos');

    window.UI.hideLoading();

    if (!result.ok) {
      window.UI.showToast(result.error || 'Erro ao carregar anos.', 'error');
      return;
    }

    state.anos = result.data.anos || [];

    // Se nenhum ano existe, criar o ano atual automaticamente
    if (state.anos.length === 0) {
      const anoAtual = new Date().getFullYear();
      window.UI.showLoading(`Criando ano ${anoAtual}...`);

      const criarResult = await window.Api.request('criar_ano', { ano: anoAtual });

      window.UI.hideLoading();

      if (criarResult.ok) {
        state.anos = [anoAtual];
      }
    }

    renderAnos();

    // Selecionar o ano mais recente
    if (state.anos.length > 0) {
      await selecionarAno(state.anos[state.anos.length - 1]);
    }
  };

  window.Vigencias = { init };
})();
