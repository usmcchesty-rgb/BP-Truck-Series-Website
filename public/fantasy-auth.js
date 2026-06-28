(function () {
  let client = null;
  let configured = false;

  async function init() {
    if (client) return client;
    const res = await fetch('/api/fantasy?action=getAuthConfig');
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
    const res = await authFetch('/api/fantasy?action=getSession');
    if (!res.ok) return null;
    return res.json();
  }

  window.BPFantasyAuth = {
    init,
    isConfigured: () => configured,
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
