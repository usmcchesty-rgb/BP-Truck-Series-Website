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

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function articleUrl(slug) {
  return `/news/${encodeURIComponent(slug)}`;
}

function renderFeatured(article) {
  const panel = $("#featuredPanel");
  const wrap = $("#featuredArticle");
  if (!panel || !wrap || !article) {
    if (panel) panel.hidden = true;
    return;
  }

  panel.hidden = false;
  wrap.innerHTML = `
    <a class="news-featured-link" href="${articleUrl(article.slug)}">
      ${article.featuredImageUrl ? `<img class="news-featured-image" src="${escapeHtml(article.featuredImageUrl)}" alt="">` : ""}
      <span class="news-type-badge">${escapeHtml(article.articleTypeLabel || article.articleType)}</span>
      <h2>${escapeHtml(article.headline)}</h2>
      ${article.subheadline ? `<p class="news-featured-sub">${escapeHtml(article.subheadline)}</p>` : ""}
      <p class="news-featured-summary">${escapeHtml(article.summary || "")}</p>
      <div class="news-meta">
        <span class="news-author">${escapeHtml(article.author || "Miles Apex")}</span>
        <time>${escapeHtml(formatDate(article.publishedAt))}</time>
      </div>
    </a>
  `;
}

function renderCard(article) {
  return `
    <article class="news-card">
      <a href="${articleUrl(article.slug)}">
        ${article.featuredImageUrl ? `<img class="news-card-image" src="${escapeHtml(article.featuredImageUrl)}" alt="">` : `<div class="news-card-thumb" aria-hidden="true">📰</div>`}
        <div class="news-card-body">
          <span class="news-type-badge">${escapeHtml(article.articleTypeLabel || article.articleType)}</span>
          <h3>${escapeHtml(article.headline)}</h3>
          <p>${escapeHtml(article.summary || "")}</p>
          <div class="news-meta">
            <span class="news-author">${escapeHtml(article.author || "Miles Apex")}</span>
            <time>${escapeHtml(formatDate(article.publishedAt))}</time>
          </div>
        </div>
      </a>
    </article>
  `;
}

async function loadNews() {
  const grid = $("#newsGrid");
  if (!grid) return;

  try {
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const articles = (data.articles || []).filter((a) => a.published);
    const featured = data.featured || articles[0] || null;

    renderFeatured(featured);

    const rest = featured
      ? articles.filter((a) => a.id !== featured.id)
      : articles;

    if (!rest.length && !featured) {
      grid.innerHTML = `<p class="muted">No published news yet. Check back after the next race weekend.</p>`;
      return;
    }

    grid.innerHTML = rest.map(renderCard).join("");
  } catch (e) {
    console.error("Failed to load news:", e);
    grid.innerHTML = `<p class="muted">Failed to load news.</p>`;
  }
}

loadNews();
