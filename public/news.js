const $ = (s) => document.querySelector(s);

const AUTHOR_BIO =
  "Motorsports journalist covering the Blazing Pedals Truck Series. Focused on race analysis, championship battles, emerging storylines, and driver performance.";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function articleUrl(slug) {
  return `/news/${encodeURIComponent(slug)}`;
}

function renderFeatured(article, settings) {
  const panel = $("#featuredPanel");
  const wrap = $("#featuredArticle");
  if (!panel || !wrap || !article) {
    if (panel) panel.hidden = true;
    return;
  }

  const readMinutes = MilesApexAvatar.articleReadMinutes(article);
  const dek = article.subheadline || article.summary || "";
  const author = article.author || "Miles Apex";

  panel.hidden = false;
  wrap.innerHTML = `
    <a class="news-featured-card" href="${articleUrl(article.slug)}">
      <div class="news-featured-media">
        ${NewsArticleImage.renderFeaturedMedia(article)}
        <span class="news-type-badge news-type-badge--overlay">${escapeHtml(article.articleTypeLabel || article.articleType)}</span>
      </div>
      <div class="news-featured-content">
        <span class="news-kicker">FEATURED STORY</span>
        <h2 class="news-featured-headline">${escapeHtml(article.headline)}</h2>
        ${dek ? `<p class="news-featured-dek">${escapeHtml(dek)}</p>` : ""}
        ${MilesApexAvatar.renderByline(settings, {
          author,
          date: article.publishedAt,
          readMinutes,
          avatarSize: "md",
        })}
      </div>
    </a>
  `;
}

function renderCard(article, settings) {
  const readMinutes = MilesApexAvatar.articleReadMinutes(article);
  const dek = article.subheadline || article.summary || "";
  const author = article.author || "Miles Apex";

  return `
    <article class="news-card-v2">
      <a class="news-card-v2-link" href="${articleUrl(article.slug)}">
        ${NewsArticleImage.renderCardMedia(article)}
        <div class="news-card-body">
          <span class="news-type-badge">${escapeHtml(article.articleTypeLabel || article.articleType)}</span>
          <h3 class="news-card-headline">${escapeHtml(article.headline)}</h3>
          ${dek ? `<p class="news-card-dek">${escapeHtml(dek)}</p>` : ""}
          ${MilesApexAvatar.renderByline(settings, {
            author,
            date: article.publishedAt,
            readMinutes,
          })}
        </div>
      </a>
    </article>
  `;
}

async function loadNews() {
  const grid = $("#newsGrid");
  if (!grid) return;

  try {
    const settings = await MilesApexAvatar.loadSettings();
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const articles = (data.articles || []).filter((a) => a.published);
    const featured = data.featured || articles[0] || null;

    renderFeatured(featured, settings);

    const rest = featured
      ? articles.filter((a) => a.id !== featured.id)
      : articles;

    if (!rest.length && !featured) {
      grid.innerHTML = `<p class="muted">No published news yet. Check back after the next race weekend.</p>`;
      return;
    }

    grid.innerHTML = rest.map((article) => renderCard(article, settings)).join("");
    if (window.BPShare?.initPageShare) {
      window.BPShare.initPageShare("#newsShareHost", {
        title: "Blazing Pedals Truck Series — News",
        text: "Latest news, race recaps, and driver spotlights from the Blazing Pedals Truck Series.",
        description: "Latest news, race recaps, and driver spotlights from the Blazing Pedals Truck Series.",
        url: window.location.href,
        image: window.BPShare.DEFAULT_IMAGE,
        type: "website",
        compact: true,
      });
    }
  } catch (e) {
    console.error("Failed to load news:", e);
    grid.innerHTML = `<p class="muted">Failed to load news.</p>`;
  }
}

loadNews();
