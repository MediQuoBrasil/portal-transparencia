/**
 * ═══════════════════════════════════════════════════════════
 *  vigencias.js — Navegação e exibição de vigências
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} VigenciaState
   * @property {number[]} anos         - Anos disponíveis
   * @property {number}   anoAtivo     - Ano selecionado
   * @property {number}   mesAtivo     - Mês selecionado (1–12)
   * @property {Object[]} vigencias    - Vigências do ano ativo
   */

  /** @type {VigenciaState} */
  const state = {
    anos: [],
    anoAtivo: 0,
    mesAtivo: 0,
    vigencias: [],
  };

  /**
   * Calcula as datas de início e fim para tooltip.
   * Vigência do mês M/AAAA: 21/(M-1) até 20/M.
   * Janeiro: 21/12/(A-1) até 20/01/A.
   *
   * @param {number} ano - Ano.
   * @param {number} mes - Mês (1–12).
   * @returns {string} Texto formatado "DD/MM/AAAA a DD/MM/AAAA".
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
   * Renderiza os botões de ano na sidebar.
   */
  const renderAnos = () => {
    const container = document.getElementById('yearSelector');
    if (!container) return;

    container.innerHTML = '';

    state.anos.forEach((ano) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'year-btn' + (ano === state.anoAtivo ? ' active' : '');
      btn.textContent = String(ano);
      btn.addEventListener('click', () => { selecionarAno(ano); });
      container.appendChild(btn);
    });

    // Botão "+"
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

      const label = document.createElement('span');
      label.textContent = v.nome;

      const tooltip = document.createElement('span');
      tooltip.className = 'month-tooltip';
      tooltip.textContent = tooltipVigencia(state.anoAtivo, v.mes);

      li.appendChild(dot);
      li.appendChild(label);
      li.appendChild(tooltip);

      li.addEventListener('click', () => { selecionarMes(v.mes); });

      list.appendChild(li);
    });
  };

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

    // Selecionar primeiro mês por padrão ou mês atual
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
    renderMeses();

    // Disparar evento para fechar sidebar no mobile
    document.dispatchEvent(new CustomEvent('month-selected'));

    // Atualizar header
    const headerTitle = document.getElementById('mainHeaderTitle');
    const headerSubtitle = document.getElementById('mainHeaderSubtitle');
    const mesNome = window.AppConfig.MESES[mes - 1] || '';

    if (headerTitle) headerTitle.textContent = `${mesNome} ${state.anoAtivo}`;
    if (headerSubtitle) {
      headerSubtitle.textContent = tooltipVigencia(state.anoAtivo, mes);
    }

    // Carregar detalhe da vigência
    await carregarDetalheVigencia(state.anoAtivo, mes);
  };

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
        '⚠️',
        'Erro ao carregar',
        result.error || 'Não foi possível carregar os dados desta vigência.',
      );
      return;
    }

    const vigencia = result.data;

    if (!vigencia.temDados) {
      // Fase 2: zona de upload será renderizada aqui
      mainBody.innerHTML = renderPlaceholder(
        '📁',
        'Nenhum dado importado',
        `A vigência de ${vigencia.nome} (${vigencia.inicio} a ${vigencia.fim}) ainda não possui dados. O upload de planilhas estará disponível em breve.`,
      );
      return;
    }

    // Fase 2: renderizar resumo de dados, botões de download, etc.
    mainBody.innerHTML = renderPlaceholder(
      '📊',
      'Dados disponíveis',
      `A vigência de ${vigencia.nome} possui dados importados. A visualização detalhada estará disponível em breve.`,
    );
  };

  /**
   * Renderiza um placeholder centralizado.
   *
   * @param {string} icon - Emoji/ícone.
   * @param {string} title - Título.
   * @param {string} text - Texto descritivo.
   * @returns {string} HTML do placeholder.
   */
  const renderPlaceholder = (icon, title, text) => `
    <div class="card">
      <div class="vigencia-placeholder">
        <div class="vigencia-placeholder-icon">${icon}</div>
        <div class="vigencia-placeholder-title">${escapeHtml(title)}</div>
        <div class="vigencia-placeholder-text">${escapeHtml(text)}</div>
      </div>
    </div>
  `;

  /**
   * Escapa HTML para prevenir XSS.
   * @param {string} str - String a escapar.
   * @returns {string}
   */
  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

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

  /**
   * Carrega a lista de anos disponíveis e inicializa a navegação.
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
