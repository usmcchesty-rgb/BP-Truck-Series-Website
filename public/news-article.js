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

function getSlugFromPath() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("slug");
  if (fromQuery) return fromQuery;

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "news" && parts[1]) {
    return decodeURIComponent(parts[1]);
  }
  return "";
}

function renderBody(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join("");
}

function renderArticle(article, settings) {
  const panel = $("#articlePanel");
  if (!panel || !article) return;

  document.title = `${article.headline} — Blazing Pedals Truck Series News`;

  const readMinutes = MilesApexAvatar.articleReadMinutes(article);
  const author = article.author || "Miles Apex";

  panel.innerHTML = `
    <a class="news-back-link" href="/news.html">← Back to News</a>
    <span class="news-type-badge">${escapeHtml(article.articleTypeLabel || article.articleType)}</span>
    <h1 class="news-article-headline">${escapeHtml(article.headline)}</h1>
    ${article.subheadline ? `<p class="news-article-subheadline">${escapeHtml(article.subheadline)}</p>` : ""}
    ${MilesApexAvatar.renderAuthorRow(settings, {
      author,
      date: article.publishedAt,
      readMinutes,
    })}
    ${NewsArticleImage.renderArticleHero(article)}
    <div class="news-article-body">${renderBody(article.body)}</div>
    <aside class="news-author-card">
      ${MilesApexAvatar.renderAvatarHtml(settings, { size: "lg", alt: author })}
      <div class="news-author-card-copy">
        <strong>${escapeHtml(author)}</strong>
        <span>Motorsports Journalist</span>
        <p>${escapeHtml(AUTHOR_BIO)}</p>
      </div>
    </aside>
  `;
}

async function loadArticle() {
  const panel = $("#articlePanel");
  const slug = getSlugFromPath();
  if (!panel) return;

  if (!slug) {
    panel.innerHTML = `<p class="muted">Article not found. <a href="/news.html">Return to News</a></p>`;
    return;
  }

  try {
    const settings = await MilesApexAvatar.loadSettings();
    const res = await fetch(`/api/news?slug=${encodeURIComponent(slug)}`);
    const data = await res.json();
    if (!res.ok || !data.article) throw new Error("Not found");
    renderArticle(data.article, settings);
  } catch (e) {
    panel.innerHTML = `<p class="muted">Article not found. <a href="/news.html">Return to News</a></p>`;
  }
}

loadArticle();
