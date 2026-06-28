(function () {
  function $(sel) {
    return document.querySelector(sel);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showMessage(el, message, { hiddenWhenEmpty = true } = {}) {
    if (!el) return;
    el.textContent = message || '';
    if (hiddenWhenEmpty) {
      el.hidden = !message;
    }
  }

  function formatAuthError(error) {
    if (!error) return 'Something went wrong.';
    return error.message || String(error);
  }

  async function handleLogin(form, submitBtn) {
    const email = String(form.email.value || '').trim();
    const password = String(form.password.value || '');
    const errorEl = $('#fantasyAuthError');
    const successEl = $('#fantasyAuthSuccess');
    showMessage(errorEl, '');
    showMessage(successEl, '');

    if (!email || !password) {
      showMessage(errorEl, 'Enter your email and password.');
      return;
    }

    const originalLabel = submitBtn?.textContent || 'Log In';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in…';
    }

    try {
      await window.BPFantasyAuth.signIn(email, password);
      window.location.href = '/fantasy/dashboard.html';
    } catch (error) {
      showMessage(errorEl, formatAuthError(error));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  }

  async function handleSignup(form, submitBtn) {
    const displayName = String(form.displayName.value || '').trim();
    const email = String(form.email.value || '').trim();
    const password = String(form.password.value || '');
    const errorEl = $('#fantasyAuthError');
    const successEl = $('#fantasyAuthSuccess');
    showMessage(errorEl, '');
    showMessage(successEl, '');

    if (!email || !password) {
      showMessage(errorEl, 'Enter your email and password.');
      return;
    }
    if (password.length < 6) {
      showMessage(errorEl, 'Password must be at least 6 characters.');
      return;
    }

    const originalLabel = submitBtn?.textContent || 'Create Account';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account…';
    }

    try {
      const result = await window.BPFantasyAuth.signUp(email, password, displayName);
      if (result?.session) {
        window.location.href = '/fantasy/dashboard.html';
        return;
      }
      showMessage(successEl, 'Check your email to confirm your BP Fantasy account.');
    } catch (error) {
      showMessage(errorEl, formatAuthError(error));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  }

  function renderLoginForm(confirmedMessage = '') {
    const root = $('#fantasyAuthRoot');
    if (!root) return;

    root.innerHTML = `
      <section class="fantasy-auth-card fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">BP Fantasy</p>
        <h1 class="fantasy-app-page-title">Log In</h1>
        <p class="fantasy-app-copy">Sign in to submit your race-week lineup.</p>
        <form id="fantasyLoginForm" class="fantasy-auth-form">
          <label>Email<input class="input" type="email" name="email" autocomplete="email" required /></label>
          <label>Password<input class="input" type="password" name="password" autocomplete="current-password" required /></label>
          <p id="fantasyAuthSuccess" class="fantasy-auth-message is-success"${confirmedMessage ? '' : ' hidden'}>${escapeHtml(confirmedMessage)}</p>
          <p id="fantasyAuthError" class="fantasy-auth-message is-error" hidden></p>
          <button type="submit" class="fantasy-btn fantasy-btn--primary">Log In</button>
        </form>
        <p class="fantasy-auth-switch">Need an account? <a class="fantasy-driver-link" href="/fantasy/signup.html">Sign up</a></p>
      </section>`;

    $('#fantasyLoginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogin(e.target, e.submitter || e.target.querySelector('button[type="submit"]'));
    });
  }

  async function initLogin() {
    const root = $('#fantasyAuthRoot');
    if (!root) return;

    try {
      await window.BPFantasyAuth.init();
      const callback = await window.BPFantasyAuth.processAuthCallback();

      if (callback?.session) {
        window.location.href = '/fantasy/dashboard.html';
        return;
      }

      const session = await window.BPFantasyAuth.getSession();
      if (session) {
        window.location.href = '/fantasy/dashboard.html';
        return;
      }

      const confirmedMessage = callback?.confirmedOnly
        ? 'Email confirmed. You can log in.'
        : '';
      renderLoginForm(confirmedMessage);
    } catch (error) {
      root.innerHTML = `<section class="fantasy-app-empty"><p class="fantasy-auth-message is-error">${escapeHtml(formatAuthError(error))}</p></section>`;
    }
  }

  async function initSignup() {
    const root = $('#fantasyAuthRoot');
    if (!root) return;

    try {
      await window.BPFantasyAuth.init();
      const callback = await window.BPFantasyAuth.processAuthCallback();

      if (callback?.session) {
        window.location.href = '/fantasy/dashboard.html';
        return;
      }

      const session = await window.BPFantasyAuth.getSession();
      if (session) {
        window.location.href = '/fantasy/dashboard.html';
        return;
      }
    } catch (error) {
      root.innerHTML = `<section class="fantasy-app-empty"><p class="fantasy-auth-message is-error">${escapeHtml(formatAuthError(error))}</p></section>`;
      return;
    }

    root.innerHTML = `
      <section class="fantasy-auth-card fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">BP Fantasy</p>
        <h1 class="fantasy-app-page-title">Sign Up</h1>
        <p class="fantasy-app-copy">Create your BP Fantasy account to save lineups.</p>
        <form id="fantasySignupForm" class="fantasy-auth-form">
          <label>Display Name<input class="input" type="text" name="displayName" autocomplete="nickname" maxlength="40" /></label>
          <label>Email<input class="input" type="email" name="email" autocomplete="email" required /></label>
          <label>Password<input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required /></label>
          <p id="fantasyAuthError" class="fantasy-auth-message is-error" hidden></p>
          <p id="fantasyAuthSuccess" class="fantasy-auth-message is-success" hidden></p>
          <button type="submit" class="fantasy-btn fantasy-btn--primary">Create Account</button>
        </form>
        <p class="fantasy-auth-switch">Already have an account? <a class="fantasy-driver-link" href="/fantasy/login.html">Log in</a></p>
      </section>`;

    $('#fantasySignupForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSignup(e.target, e.submitter || e.target.querySelector('button[type="submit"]'));
    });
  }

  window.BPFantasyAuthForms = { initLogin, initSignup };
})();
