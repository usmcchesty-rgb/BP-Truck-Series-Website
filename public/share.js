(function () {
  const Meta = window.BPShareMeta || {};
  const DEFAULT_IMAGE = Meta.DEFAULT_IMAGE || '/assets/logos/New Clean Logo.png';

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

  const SOCIAL_ICONS = {
    facebook: '/assets/social/facebook.svg',
    x: '/assets/social/X.svg',
    link: '/assets/social/Link.svg',
    instagram: '/assets/social/instagram.svg',
    // Set when assets are added: /assets/social/share.svg, /assets/social/tiktok.svg
    share: null,
    tiktok: null,
  };

  function shareIconMarkup(iconPath, label) {
    return `<img class="bp-share__icon" src="${escapeAttr(iconPath)}" alt="" width="18" height="18" decoding="async" />`;
  }

  function iconActionButton(action, iconPath, textFallback, tooltip) {
    const safeTip = escapeAttr(tooltip);
    if (iconPath) {
      return `<button type="button" class="bp-share__btn bp-share__btn--icon" data-share-action="${escapeAttr(action)}" data-share-icon="${escapeAttr(iconPath)}" title="${safeTip}" aria-label="${safeTip}">${shareIconMarkup(iconPath, tooltip)}</button>`;
    }
    return `<button type="button" class="bp-share__btn bp-share__btn--text" data-share-action="${escapeAttr(action)}" title="${safeTip}" aria-label="${safeTip}"><span class="bp-share__text-label">${escapeAttr(textFallback)}</span></button>`;
  }

  function renderShareButtons(options = {}) {
    const title = options.title || document.title;
    const url = absoluteUrl(options.url || window.location.href);
    const compact = options.compact === true;
    const showLabel = options.showLabel === true;

    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

    return `<div class="bp-share${compact ? ' bp-share--compact' : ''}" data-bp-share>
      ${showLabel ? '<p class="bp-share__label">Share</p>' : ''}
      <a class="bp-share__btn bp-share__btn--icon" href="${escapeAttr(facebookUrl)}" target="_blank" rel="noopener noreferrer" title="Share to Facebook" aria-label="Share to Facebook">${shareIconMarkup(SOCIAL_ICONS.facebook, 'Share to Facebook')}</a>
      <a class="bp-share__btn bp-share__btn--icon" href="${escapeAttr(xUrl)}" target="_blank" rel="noopener noreferrer" title="Share to X" aria-label="Share to X">${shareIconMarkup(SOCIAL_ICONS.x, 'Share to X')}</a>
      <button type="button" class="bp-share__btn bp-share__btn--icon" data-share-action="copy" title="Copy Link" aria-label="Copy Link">${shareIconMarkup(SOCIAL_ICONS.link, 'Copy Link')}</button>
      ${iconActionButton('native', SOCIAL_ICONS.share, 'Share', 'Share')}
      <button type="button" class="bp-share__btn bp-share__btn--icon" data-share-action="copy-instagram" title="Copy for Instagram" aria-label="Copy for Instagram">${shareIconMarkup(SOCIAL_ICONS.instagram, 'Copy for Instagram')}</button>
      ${iconActionButton('copy-tiktok', SOCIAL_ICONS.tiktok, 'TikTok', 'Copy for TikTok')}
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

  function mountShareButtons(target, options = {}) {
    const container =
      typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return null;

    container.innerHTML = renderShareButtons(options);
    const shareRoot = container.querySelector('[data-bp-share]') || container;
    bindShareContainer(shareRoot, options);
    return shareRoot;
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
    renderShareButtons,
    mountShareButtons,
    initPageShare,
    copyLink,
    nativeShare,
    showToast,
  };
})();
