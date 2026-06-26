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

  function renderShareButtons(options = {}) {
    const title = options.title || document.title;
    const text = options.text || '';
    const url = absoluteUrl(options.url || window.location.href);
    const compact = options.compact === true;
    const showLabel = options.showLabel !== false;

    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

    return `<div class="bp-share${compact ? ' bp-share--compact' : ''}" data-bp-share>
      ${showLabel ? '<p class="bp-share__label">Share</p>' : ''}
      <a class="bp-share__btn bp-share__btn--facebook" href="${escapeAttr(facebookUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Share to Facebook">Facebook</a>
      <a class="bp-share__btn bp-share__btn--x" href="${escapeAttr(xUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Share to X">X</a>
      <button type="button" class="bp-share__btn" data-share-action="copy" aria-label="Copy Link">Copy Link</button>
      <button type="button" class="bp-share__btn" data-share-action="native" aria-label="Share">Share</button>
      <button type="button" class="bp-share__btn" data-share-action="copy-instagram" aria-label="Copy for Instagram">Copy for Instagram</button>
      <button type="button" class="bp-share__btn" data-share-action="copy-tiktok" aria-label="Copy for TikTok">Copy for TikTok</button>
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
