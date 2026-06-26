(function () {
  const Meta = window.BPShareMeta || {};
  const DEFAULT_IMAGE = Meta.DEFAULT_IMAGE || '/assets/logos/New Clean Logo.png';

  const FALLBACK_CONFIG = {
    boxSizePx: 48,
    iconMaxPx: 40,
    platforms: [
      { id: 'facebook', tooltip: 'Share to Facebook', icon: '/assets/social/facebook.svg', render: 'external' },
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

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let toastEl = null;
  let toastTimer = null;

  function showToast(message) {
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
    }, 2200);
  }

  function copyLink(url) {
    const text = absoluteUrl(url);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => {
        showToast('Link copied.');
      });
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
        showToast('Link copied.');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
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
    const url = absoluteUrl(shareOptions.url || window.location.href);

    if (platform.id === 'facebook') {
      const href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
      return renderExternalLink(platform, href);
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
      url: absoluteUrl(options.url || window.location.href),
    };

    container.querySelectorAll('[data-share-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-share-action');
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
    loadShareConfig,
    renderShareButtons,
    mountShareButtons,
    initPageShare,
    copyLink,
    nativeShare,
    showToast,
  };
})();
