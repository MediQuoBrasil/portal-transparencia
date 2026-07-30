/**
 * ═══════════════════════════════════════════════════════════
 *  auth.js — Autenticação com Google Identity Services
 * ═══════════════════════════════════════════════════════════
 *
 *  Usa Google One Tap (FedCM): mini pop-up no canto superior
 *  direito com as contas Google do usuário, sem abrir nova janela.
 *
 *  Sessão armazenada em sessionStorage (expira ao fechar navegador).
 */

(function () {
  'use strict';

  /**
   * @typedef {Object} SessionData
   * @property {string}   token  - JWT do Google
   * @property {string}   email  - E-mail do usuário
   * @property {string}   nome   - Nome do usuário
   * @property {string}   role   - Papel (admin | gestor | financeiro)
   */

  /** @type {HTMLElement} */
  let loginScreen;

  /** @type {HTMLElement} */
  let loginError;

  /**
   * Verifica se existe uma sessão válida no sessionStorage.
   * @returns {SessionData|null}
   */
  const getSession = () => {
    try {
      const raw = sessionStorage.getItem(window.AppConfig.SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session.token || !session.email) return null;
      return session;
    } catch (_) {
      return null;
    }
  };

  /**
   * Salva os dados de sessão no sessionStorage.
   * @param {SessionData} data - Dados da sessão.
   */
  const saveSession = (data) => {
    sessionStorage.setItem(
      window.AppConfig.SESSION_KEY,
      JSON.stringify(data),
    );
  };

  /**
   * Remove a sessão e redireciona para a tela de login.
   */
  const logout = () => {
    sessionStorage.removeItem(window.AppConfig.SESSION_KEY);

    // Revogar sessão do Google
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }

    // Esconder app, mostrar login
    const appShell = document.getElementById('appShell');
    if (appShell) appShell.classList.remove('active');
    if (loginScreen) loginScreen.style.display = '';

    // Restaurar botão customizado (pode ter sido escondido pelo fallback)
    const customBtn = document.getElementById('googleSignInBtn');
    if (customBtn) customBtn.style.display = '';

    // Esconder container de fallback
    const fallback = document.getElementById('googleBtnContainer');
    if (fallback) fallback.style.display = 'none';

    // Re-inicializar GIS
    initGIS();
  };

  /**
   * Exibe mensagem de erro na tela de login.
   * @param {string} msg - Mensagem de erro.
   */
  const showLoginError = (msg) => {
    if (loginError) {
      loginError.textContent = msg;
      loginError.classList.add('show');
    }
  };

  /**
   * Esconde mensagem de erro.
   */
  const hideLoginError = () => {
    if (loginError) loginError.classList.remove('show');
  };

  /**
   * Callback chamado pelo Google Identity Services ao receber o credential.
   * Valida no backend e inicializa a aplicação.
   *
   * @param {Object} response - Resposta do GIS.
   * @param {string} response.credential - JWT assinado pelo Google.
   */
  const handleCredentialResponse = async (response) => {
    hideLoginError();

    // Mostrar loading
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.add('show');

    try {
      const result = await window.Api.login(response.credential);

      if (!result.ok) {
        showLoginError(result.error || 'Acesso não autorizado.');
        return;
      }

      // Salvar sessão
      saveSession({
        token: response.credential,
        email: result.data.email,
        nome: result.data.nome,
        role: result.data.role,
      });

      // Inicializar app
      loginScreen.style.display = 'none';
      window.App.init(result.data);
    } catch (err) {
      console.error('[Auth] Erro ao processar login:', err);
      showLoginError('Erro ao processar login. Tente novamente.');
    } finally {
      if (loadingOverlay) loadingOverlay.classList.remove('show');
    }
  };

  /**
   * Inicializa o Google Identity Services.
   * Apenas configura o callback — sem renderizar botão nem disparar prompt aqui.
   */
  const initGIS = () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      console.warn('[Auth] Biblioteca GIS não carregou.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: window.AppConfig.GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  };

  /**
   * Aciona o Google One Tap (mini popup no canto superior direito).
   * Se o One Tap estiver indisponível, renderiza o botão oficial do Google
   * como fallback no container dedicado.
   */
  const triggerGoogleSignIn = () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      showLoginError('Google Sign In não disponível. Recarregue a página.');
      return;
    }

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        console.log('[Auth] One Tap indisponível:', notification.getNotDisplayedReason());
        renderGoogleFallback();
      }
      if (notification.isSkippedMoment()) {
        console.log('[Auth] One Tap dispensado:', notification.getSkippedReason());
      }
    });
  };

  /**
   * Renderiza o botão oficial do Google como fallback.
   * Esconde o botão customizado e exibe o container do botão padrão.
   */
  const renderGoogleFallback = () => {
    const container = document.getElementById('googleBtnContainer');
    if (!container) return;

    container.innerHTML = '';
    container.style.display = 'flex';

    window.google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      width: 280,
      text: 'signin_with',
      locale: 'pt-BR',
    });

    // Esconder botão customizado
    const customBtn = document.getElementById('googleSignInBtn');
    if (customBtn) customBtn.style.display = 'none';
  };

  /**
   * Vincula o botão customizado ao fluxo de login.
   */
  const bindLoginButton = () => {
    const btn = document.getElementById('googleSignInBtn');
    if (btn) {
      btn.addEventListener('click', triggerGoogleSignIn);
    }
  };

  /**
   * Ponto de entrada da autenticação.
   * Verifica sessão existente ou inicia fluxo de login.
   */
  const init = () => {
    loginScreen = document.getElementById('loginScreen');
    loginError = document.getElementById('loginError');

    // Inicializar GIS (configura callback)
    initGIS();

    // Vincular botão customizado
    bindLoginButton();

    const session = getSession();

    if (session) {
      // Sessão existente — inicializar direto.
      // Warmup já foi disparado automaticamente pelo prefetch.js
      // no carregamento do script (antes do GIS e antes deste init).
      loginScreen.style.display = 'none';
      window.App.init({
        email: session.email,
        nome: session.nome,
        role: session.role,
      });
    } else {
      // Sem sessão — exibir login.
      // Warmup já foi disparado no carregamento do prefetch.js,
      // então o backend estará quente quando o login completar.
      loginScreen.style.display = '';
    }
  };

  window.Auth = {
    init,
    logout,
    getSession,
  };
})();
