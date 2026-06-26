(function () {
  const Meta = window.BPShareMeta || {};
  const DEFAULT_IMAGE = Meta.DEFAULT_IMAGE || '/assets/logos/New Clean Logo.png';

  const FALLBACK_CONFIG = {
    boxSizePx: 48,
    iconMaxPx: 40,
    platforms: [
      { id: 'facebook', tooltip: 'Share / Copy for Facebook', icon: '/assets/social/facebook.svg', action: 'facebook' },
      { id: 'x', tooltip: 'Share to X', icon: '/assets/social/x.svg', render: 'external' },
      { id: 'instagram', tooltip: 'Copy for Instagram', icon: '/assets/social/instagram.svg', action: 'copy-instagram' },
      { id: 'link', tooltip: 'Copy Link', icon: '/assets/social/link.svg', action: 'copy' },
    ],
  };

  let shareConfigCache = null;
  let shareConfigPromise = null;

  function absoluteUrl(pathOrUrl) {
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return window.location.href.split('#')[0];
    if (/^https?:\/\//i.test(raw)) return raw;
    const origin = window.location.origin || '';
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${origin}${encodeURI(path)}`;
  }

  function canonicalShareUrl(options = {}) {
    const raw = String(options.url || window.location.href).trim();
    try {
      const loc = new URL(raw, window.location.origin);
      const parts = loc.pathname.split('/').filter(Boolean);

      if (parts[0] === 'news' && parts[1] && !parts[1].endsWith('.html')) {
        return absoluteUrl(`/news/${decodeURIComponent(parts[1])}`);
      }

      if (loc.pathname.endsWith('/news-article.html') || parts[0] === 'news-article.html') {
        const slug = new URLSearchParams(loc.search).get('slug');
        if (slug) return absoluteUrl(`/news/${slug}`);
      }

      if (parts[0] === 'drivers' && parts[1] && !parts[1].endsWith('.html')) {
        return absoluteUrl(`/drivers/${decodeURIComponent(parts[1])}`);
      }

      if (loc.pathname.endsWith('/driver-profile.html') || parts[0] === 'driver-profile.html') {
        const driverId =
          new URLSearchParams(loc.search).get('driverId') ||
          new URLSearchParams(loc.search).get('driver');
        if (driverId) return absoluteUrl(`/drivers/${encodeURIComponent(driverId)}`);
      }

      return absoluteUrl(`${loc.origin}${loc.pathname}`);
    } catch {
      return absoluteUrl(window.location.pathname);
    }
  }

  function isTouchDevice() {
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      if (window.matchMedia('(hover: none)').matches) return true;
    }
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let toastEl = null;
  let toastTimer = null;

  function showToast(message, durationMs = 2200) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'bp-share__toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
    }, durationMs);
  }

  function copyToClipboard(url, options = {}) {
    const text = absoluteUrl(url);
    const toastMessage = options.toastMessage;
    const silent = options.silent === true;

    const finish = () => {
      if (!silent && toastMessage) showToast(toastMessage);
    };

    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(finish);
    }

    return new Promise((resolve, reject) => {
      try {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(input);
        if (!ok) throw new Error('copy failed');
        finish();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  function copyLink(url) {
    return copyToClipboard(url, { toastMessage: 'Link copied.' });
  }

  function nativeShare({ title, text, url }) {
    if (!navigator.share) {
      return copyLink(url);
    }
    return navigator.share({
      title: title || document.title,
      text: text || '',
      url: absoluteUrl(url),
    });
  }

  async function shareFacebook(payload) {
    const url = payload.url;
    const mobileToast = 'Link copied. Share it to Facebook or paste it into your post.';
    const desktopToast = 'Link copied. If Facebook does not finish loading, paste the link manually.';

    try {
      await copyToClipboard(url, { silent: true });
    } catch {
      showToast('Could not copy link.');
      return;
    }

    if (isTouchDevice()) {
      if (navigator.share) {
        try {
          await navigator.share({
            title: payload.title || document.title,
            text: payload.text || '',
            url,
          });
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      showToast(mobileToast, 3200);
      return;
    }

    showToast(desktopToast, 3200);
    const href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function loadShareConfig(forceRefresh) {
    if (forceRefresh) {
      shareConfigCache = null;
      shareConfigPromise = null;
    }
    if (shareConfigCache) return Promise.resolve(shareConfigCache);
    if (!shareConfigPromise) {
      shareConfigPromise = fetch('/api/settings?action=getSocialShareConfig')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          shareConfigCache =
            data && Array.isArray(data.platforms) && data.platforms.length ? data : FALLBACK_CONFIG;
          return shareConfigCache;
        })
        .catch(() => {
          shareConfigCache = FALLBACK_CONFIG;
          return shareConfigCache;
        });
    }
    return shareConfigPromise;
  }

  function iconBoxMarkup(iconUrl, textFallback) {
    if (iconUrl) {
      return `<span class="share-icon-box"><img class="share-icon-img" src="${escapeAttr(iconUrl)}" alt="" decoding="async" /></span>`;
    }
    return `<span class="share-icon-box share-icon-box--text"><span class="share-icon-box__label">${escapeAttr(textFallback || 'Share')}</span></span>`;
  }

  function renderExternalLink(platform, href) {
    return `<a class="share-action" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(platform.tooltip)}" aria-label="${escapeAttr(platform.tooltip)}">${iconBoxMarkup(platform.icon, platform.textFallback)}</a>`;
  }

  function renderActionButton(platform) {
    return `<button type="button" class="share-action" data-share-action="${escapeAttr(platform.action)}" title="${escapeAttr(platform.tooltip)}" aria-label="${escapeAttr(platform.tooltip)}">${iconBoxMarkup(platform.icon, platform.textFallback)}</button>`;
  }

  function renderPlatformControl(platform, shareOptions) {
    const title = shareOptions.title || document.title;
    const url = canonicalShareUrl(shareOptions);

    if (platform.id === 'facebook') {
      return renderActionButton({
        ...platform,
        action: 'facebook',
        tooltip: platform.tooltip || 'Share / Copy for Facebook',
      });
    }
    if (platform.id === 'x') {
      const href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
      return renderExternalLink(platform, href);
    }
    if (platform.action) {
      return renderActionButton(platform);
    }
    return '';
  }

  function applyShareSizing(root, config) {
    if (!root || !config) return;
    const box = `${config.boxSizePx || 48}px`;
    const max = `${config.iconMaxPx || 40}px`;
    root.style.setProperty('--social-share-box-size', box);
    root.style.setProperty('--social-share-icon-max', max);
    root.style.setProperty('--bp-share-box-size', box);
    root.style.setProperty('--bp-share-icon-max', max);
  }

  function renderShareButtons(options = {}, config = shareConfigCache || FALLBACK_CONFIG) {
    const compact = options.compact === true;
    const showLabel = options.showLabel === true;
    const platforms = Array.isArray(config.platforms) ? config.platforms : FALLBACK_CONFIG.platforms;
    const controls = platforms.map((platform) => renderPlatformControl(platform, options)).join('');

    if (!controls.trim()) return '';

    return `<div class="bp-share${compact ? ' bp-share--compact' : ''}" data-bp-share>
      ${showLabel ? '<p class="bp-share__label">Share</p>' : ''}
      ${controls}
    </div>`;
  }

  function bindShareContainer(container, options = {}) {
    if (!container) return;

    const payload = {
      title: options.title || document.title,
      text: options.text || '',
      url: canonicalShareUrl(options),
    };

    container.querySelectorAll('[data-share-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-share-action');
        if (action === 'facebook') {
          shareFacebook(payload);
          return;
        }
        if (action === 'copy' || action === 'copy-instagram' || action === 'copy-tiktok') {
          copyLink(payload.url).catch(() => showToast('Could not copy link.'));
          return;
        }
        if (action === 'native') {
          nativeShare(payload).catch((error) => {
            if (error?.name !== 'AbortError') {
              copyLink(payload.url).catch(() => showToast('Could not copy link.'));
            }
          });
        }
      });
    });
  }

  function mountShareButtons(target, options = {}, config) {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return null;

    const render = (cfg) => {
      container.innerHTML = renderShareButtons(options, cfg);
      const shareRoot = container.querySelector('[data-bp-share]');
      if (!shareRoot) {
        container.innerHTML = '';
        return null;
      }
      applyShareSizing(shareRoot, cfg);
      bindShareContainer(shareRoot, options);
      return shareRoot;
    };

    if (config) return render(config);

    loadShareConfig().then(render);
    return null;
  }

  function initPageShare(target, options = {}) {
    if (Meta.updateShareMeta) {
      Meta.updateShareMeta({
        title: options.title,
        description: options.description || options.text,
        image: options.image,
        url: options.url,
        type: options.type,
      });
    }
    return mountShareButtons(target, options);
  }

  window.BPShare = {
    DEFAULT_IMAGE,
    absoluteUrl,
    canonicalShareUrl,
    loadShareConfig,
    renderShareButtons,
    mountShareButtons,
    initPageShare,
    copyLink,
    nativeShare,
    showToast,
  };
})();
