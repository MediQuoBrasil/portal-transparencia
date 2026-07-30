/**
 * ═══════════════════════════════════════════════════════════
 *  ui.js — Utilitários de interface
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ─── Tema ───────────────────────────────────────────────

  /**
   * Inicializa o tema (lê do localStorage ou usa dark como padrão).
   */
  const initTheme = () => {
    const saved = localStorage.getItem('theme');
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
  };

  /**
   * Alterna entre tema claro e escuro.
   */
  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch { /* ok */ }
    updateThemeIcon(next);
  };

  /**
   * Atualiza o ícone do botão de tema.
   * @param {string} theme - 'dark' ou 'light'.
   */
  const updateThemeIcon = (theme) => {
    const moon = document.getElementById('iconMoon');
    const sun = document.getElementById('iconSun');
    if (moon) moon.style.display = theme === 'dark' ? 'block' : 'none';
    if (sun) sun.style.display = theme === 'light' ? 'block' : 'none';
  };

  /**
   * Vincula o botão de tema ao toggle.
   */
  const bindThemeToggle = () => {
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  };

  // ─── Toast ──────────────────────────────────────────────

  /** @type {number|null} */
  let toastTimer = null;

  /**
   * Exibe um toast notification na parte inferior da tela.
   *
   * @param {string} msg - Mensagem a exibir.
   * @param {'success'|'error'|''} [type=''] - Tipo visual do toast.
   * @param {number} [duration=4000] - Duração em ms.
   */
  const showToast = (msg, type = '', duration = 4000) => {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'toast' + (type ? ` toast-${type}` : '');
    el.textContent = msg;
    document.body.appendChild(el);

    requestAnimationFrame(() => { el.classList.add('show'); });

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.remove(); }, 400);
    }, duration);
  };

  /**
   * Exibe o overlay de loading global.
   * @param {string} [text='Carregando...'] - Texto opcional.
   */
  const showLoading = (text = 'Carregando...') => {
    const overlay = document.getElementById('loadingOverlay');
    const textEl = overlay && overlay.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    if (overlay) overlay.classList.add('show');
  };

  /**
   * Esconde o overlay de loading global.
   */
  const hideLoading = () => {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('show');
  };

  /**
   * Inicializa o toggle da sidebar em telas mobile.
   */
  const initSidebarToggle = () => {
    const toggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    const open = () => {
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('show');
    };

    const close = () => {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
    };

    toggle.addEventListener('click', open);
    if (overlay) overlay.addEventListener('click', close);

    // Fechar sidebar ao selecionar um mês (mobile)
    document.addEventListener('month-selected', close);
  };

  /**
   * Retorna as iniciais de um nome (até 2 caracteres).
   * @param {string} nome - Nome completo.
   * @returns {string}
   */
  const getIniciais = (nome) => {
    if (!nome) return '?';
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
  };

  /**
   * Formata valor para moeda brasileira.
   * @param {number} valor - Valor numérico.
   * @returns {string}
   */
  const formatarMoeda = (valor) => 'R$ ' + Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  window.UI = {
    initTheme,
    toggleTheme,
    bindThemeToggle,
    showToast,
    showLoading,
    hideLoading,
    initSidebarToggle,
    getIniciais,
    formatarMoeda,
  };
})();
