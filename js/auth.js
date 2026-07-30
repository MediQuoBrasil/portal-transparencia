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

    // Re-iniciar One Tap
    initOneTap();
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
   *
   * Estratégia em duas camadas:
   *  1. One Tap (prompt) → mini popup no canto superior direito, sem abrir janela.
   *     Controlado por google.accounts.id.prompt(). É o método primário.
   *  2. Botão renderizado (renderButton) → fallback para quando o One Tap
   *     não pode ser exibido (dispensado muitas vezes, cookies de terceiros
   *     bloqueados, FedCM indisponível, etc.). Mesmo assim, abre apenas
   *     um popup com seleção de conta — não redireciona.
   *
   * O comportamento de "mini popup no canto" vs "nova janela" depende
   * exclusivamente desta implementação. Não há API a ativar no GCP;
   * basta criar as credenciais OAuth 2.0 normalmente.
   */
  const initOneTap = () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      console.warn('[Auth] Biblioteca GIS não carregou.');
      return;
    }

    const gis = window.google.accounts.id;

    // Inicialização única — configura callback e preferências
    gis.initialize({
      client_id: window.AppConfig.GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true,
      use_fedcm_for_prompt: true,
    });

    // 1. Tentar One Tap (mini popup no canto)
    gis.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        console.log('[Auth] One Tap indisponível:', notification.getNotDisplayedReason());
      }
      if (notification.isSkippedMoment()) {
        console.log('[Auth] One Tap dispensado:', notification.getSkippedReason());
      }
    });

    // 2. Renderizar botão de fallback (sempre visível na tela de login)
    const btnContainer = document.getElementById('googleBtnContainer');
    if (btnContainer) {
      gis.renderButton(btnContainer, {
        type: 'standard',
        shape: 'pill',
        theme: 'outline',
        text: 'signin_with',
        size: 'large',
        width: 300,
      });
    }
  };

  /**
   * Ponto de entrada da autenticação.
   * Verifica sessão existente ou inicia fluxo de login.
   */
  const init = () => {
    loginScreen = document.getElementById('loginScreen');
    loginError = document.getElementById('loginError');

    const session = getSession();

    if (session) {
      // Sessão existente — inicializar direto
      loginScreen.style.display = 'none';
      window.App.init({
        email: session.email,
        nome: session.nome,
        role: session.role,
      });
    } else {
      // Sem sessão — exibir login
      loginScreen.style.display = '';
      initOneTap();
    }
  };

  window.Auth = {
    init,
    logout,
    getSession,
  };
})();
