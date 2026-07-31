/**
 * ═══════════════════════════════════════════════════════════
 *  app.js — Módulo principal da aplicação
 * ═══════════════════════════════════════════════════════════
 *
 *  Orquestra a inicialização do app-shell após autenticação,
 *  renderiza a sidebar com dados do usuário e delega a
 *  navegação para o módulo de vigências.
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} UserData
   * @property {string} email - E-mail do usuário
   * @property {string} nome  - Nome do usuário
   * @property {string} role  - Papel (admin | gestor | financeiro)
   */

  /**
   * Inicializa o app após login bem-sucedido.
   * Renderiza o shell e carrega os dados iniciais.
   *
   * @param {UserData} userData - Dados do usuário logado.
   */
  const init = (userData) => {
    const appShell = document.getElementById('appShell');
    if (!appShell) return;

    // Mostrar o app-shell
    appShell.classList.add('active');

    // Renderizar info do usuário na sidebar
    renderUserInfo(userData);

    // Inicializar sidebar toggle mobile
    window.UI.initSidebarToggle();

    // Configurar logout
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Sair do painel?')) {
          window.Auth.logout();
        }
      });
    }

    // Carregar vigências
    window.Vigencias.init();

    // Vincular navegação de análise (Fase 4)
    if (window.Vigencias.bindSidebarAnalise) {
      window.Vigencias.bindSidebarAnalise();
    }
  };

  /**
   * Renderiza as informações do usuário na sidebar footer.
   * @param {UserData} userData - Dados do usuário.
   */
  const renderUserInfo = (userData) => {
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');

    if (avatar) {
      avatar.textContent = window.UI.getIniciais(userData.nome);
    }

    if (nameEl) {
      nameEl.textContent = userData.nome || userData.email;
    }

    if (roleEl) {
      const roleLabels = {
        admin: 'Administrador',
        gestor: 'Gestor',
        financeiro: 'Financeiro',
      };
      roleEl.textContent = roleLabels[userData.role] || userData.role;
    }
  };

  window.App = { init };
})();
