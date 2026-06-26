(function () {
  const SITE_NAME = 'Blazing Pedals Truck Series';
  const DEFAULT_IMAGE = '/assets/logos/New Clean Logo.png';
  const DEFAULT_DESCRIPTION =
    'Blazing Pedals Truck Series — fast drivers, close racing, and big fun in Season 11 sim racing.';

  function absoluteUrl(pathOrUrl) {
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return window.location.href.split('#')[0];
    if (/^https?:\/\//i.test(raw)) return raw;
    const origin = window.location.origin || '';
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${origin}${encodeURI(path)}`;
  }

  function setMetaTag(selector, content) {
    if (content == null || content === '') return;
    let el = document.head.querySelector(selector);
    if (!el) {
      const isProperty = selector.includes('property=');
      const isName = selector.includes('name=');
      el = document.createElement('meta');
      if (isProperty) {
        el.setAttribute('property', selector.match(/property="([^"]+)"/)[1]);
      } else if (isName) {
        el.setAttribute('name', selector.match(/name="([^"]+)"/)[1]);
      }
      document.head.appendChild(el);
    }
    el.setAttribute('content', String(content));
  }

  function updateShareMeta(options = {}) {
    const title = options.title || document.title || SITE_NAME;
    const description = options.description || DEFAULT_DESCRIPTION;
    const image = absoluteUrl(options.image || DEFAULT_IMAGE);
    const url = absoluteUrl(options.url || window.location.href);
    const type = options.type || 'website';

    document.title = title;

    setMetaTag('meta[name="description"]', description);
    setMetaTag('meta[property="og:site_name"]', SITE_NAME);
    setMetaTag('meta[property="og:title"]', title);
    setMetaTag('meta[property="og:description"]', description);
    setMetaTag('meta[property="og:image"]', image);
    setMetaTag('meta[property="og:url"]', url);
    setMetaTag('meta[property="og:type"]', type);
    setMetaTag('meta[name="twitter:card"]', 'summary_large_image');
    setMetaTag('meta[name="twitter:title"]', title);
    setMetaTag('meta[name="twitter:description"]', description);
    setMetaTag('meta[name="twitter:image"]', image);

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);
  }

  window.BPShareMeta = {
    SITE_NAME,
    DEFAULT_IMAGE,
    DEFAULT_DESCRIPTION,
    absoluteUrl,
    updateShareMeta,
  };
})();
