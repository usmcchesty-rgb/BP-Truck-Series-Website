(function () {
  let client = null;
  let configured = false;

  function getEmailRedirectUrl() {
    return `${window.location.origin}/fantasy/login.html`;
  }

  function hasAuthParamsInUrl() {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return (
      hash.includes('access_token=') ||
      hash.includes('refresh_token=') ||
      hash.includes('type=') ||
      search.includes('code=') ||
      search.includes('token_hash=') ||
      search.includes('type=') ||
      search.includes('error=') ||
      search.includes('error_description=')
    );
  }

  function readAuthCallbackFlags() {
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search || '');
    const type = hashParams.get('type') || searchParams.get('type') || '';
    const errorDescription = searchParams.get('error_description');
    return {
      type,
      confirmedOnly: type === 'signup' || type === 'email' || type === 'magiclink',
      errorDescription: errorDescription
        ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
        : null,
    };
  }

  function clearAuthParamsFromUrl() {
    if (!hasAuthParamsInUrl()) return;
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function init() {
    if (client) return client;
    const res = await fetch('/api/settings?action=getAuthConfig');
    if (!res.ok) throw new Error('Auth config unavailable.');
    const config = await res.json();
    if (!config?.configured || !config.url || !config.anonKey) {
      configured = false;
      throw new Error('Fantasy login is not configured yet.');
    }
    if (!window.supabase?.createClient) {
      throw new Error('Supabase client library not loaded.');
    }
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    configured = true;
    return client;
  }

  async function processAuthCallback() {
    const sb = await init();
    const hadAuthParams = hasAuthParamsInUrl();
    const flags = readAuthCallbackFlags();

    if (flags.errorDescription) {
      clearAuthParamsFromUrl();
      throw new Error(flags.errorDescription);
    }

    const code = new URLSearchParams(window.location.search || '').get('code');
    let { data, error } = await sb.auth.getSession();

    if (!data?.session && code) {
      const exchanged = await sb.auth.exchangeCodeForSession(code);
      data = exchanged.data;
      error = exchanged.error;
    }

    if (hadAuthParams) clearAuthParamsFromUrl();

    if (error) throw error;

    return {
      session: data?.session || null,
      fromCallback: hadAuthParams,
      confirmedOnly: Boolean(hadAuthParams && !data?.session && flags.confirmedOnly),
    };
  }

  async function getSession() {
    const sb = await init();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function getAccessToken() {
    const session = await getSession();
    return session?.access_token || null;
  }

  async function signUp(email, password, displayName) {
    const sb = await init();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || '' },
        emailRedirectTo: getEmailRedirectUrl(),
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const sb = await init();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = await init();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  }

  function onAuthStateChange(callback) {
    return init().then((sb) => sb.auth.onAuthStateChange(callback));
  }

  async function authFetch(url, options = {}) {
    const token = await getAccessToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers });
  }

  async function getProfile() {
    const res = await authFetch('/api/settings?action=getSession');
    if (!res.ok) return null;
    return res.json();
  }

  window.BPFantasyAuth = {
    init,
    isConfigured: () => configured,
    getEmailRedirectUrl,
    hasAuthParamsInUrl,
    processAuthCallback,
    getSession,
    getAccessToken,
    signUp,
    signIn,
    signOut,
    onAuthStateChange,
    authFetch,
    getProfile,
  };
})();
