(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return '#';
    return escapeHtml(trimmed);
  }

  function renderInline(text) {
    let html = escapeHtml(String(text ?? ''));

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const href = sanitizeUrl(url);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return html;
  }

  function normalizeArticleMarkdown(text) {
    let s = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2');
    s = s.replace(/^(#{1,3}\s[^\n]+)\n(?!\n)([^\n#])/gm, '$1\n\n$2');
    return s;
  }

  function renderHeadingLine(line) {
    const match = String(line || '').trim().match(/^(#{1,3})\s+(.+)$/);
    if (!match) return '';
    const level = match[1].length;
    const title = match[2];
    if (level >= 3) {
      return `<h3 class="news-article-h3 news-article-subheading">${renderInline(title)}</h3>`;
    }
    return `<h2 class="news-article-h2 news-article-heading">${renderInline(title)}</h2>`;
  }

  function renderBlock(block) {
    const trimmed = String(block || '').trim();
    if (!trimmed) return '';

    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return '';

    const first = lines[0];
    const headingOnFirst = /^(#{1,3})\s+/.test(first);

    if (headingOnFirst) {
      let html = renderHeadingLine(first);
      if (lines.length > 1) {
        html += renderBlocks(lines.slice(1).join('\n\n'));
      }
      return html;
    }

    if (lines.every((line) => /^>\s?/.test(line))) {
      return `<blockquote class="news-article-quote">${lines
        .map((line) => `<p>${renderInline(line.replace(/^>\s?/, ''))}</p>`)
        .join('')}</blockquote>`;
    }

    if (lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul class="news-article-list">${lines
        .map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`)
        .join('')}</ul>`;
    }

    if (lines.length > 1 && lines.every((line) => /^\d+\.\s+/.test(line))) {
      return `<ol class="news-article-list news-article-list--numbered">${lines
        .map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`)
        .join('')}</ol>`;
    }

    if (/^>\s?/.test(first) && lines.length === 1) {
      return `<blockquote class="news-article-quote"><p>${renderInline(first.replace(/^>\s?/, ''))}</p></blockquote>`;
    }

    return `<p>${renderInline(trimmed.replace(/\n+/g, ' '))}</p>`;
  }

  function renderBlocks(text) {
    const normalized = normalizeArticleMarkdown(text);
    return normalized
      .split(/\n\s*\n/)
      .map((block) => renderBlock(block))
      .filter(Boolean)
      .join('');
  }

  function renderCallout(content) {
    const trimmed = String(content || '').trim();
    let label = 'BP NOTE';
    let bodyText = trimmed;

    const labeled = trimmed.match(/^\*\*([^*]+):\*\*\s*([\s\S]*)$/);
    if (labeled) {
      label = labeled[1].trim();
      bodyText = labeled[2].trim();
    }

    const bodyHtml = bodyText ? renderBlocks(bodyText) : '';
    return `<aside class="news-callout"><span class="news-callout-label">${escapeHtml(label)}</span><div class="news-callout-body">${bodyHtml}</div></aside>`;
  }

  function splitCallouts(text) {
    const parts = [];
    const calloutRe = /:::callout[ \t]*\r?\n([\s\S]*?)\r?\n:::/gi;
    let lastIndex = 0;
    let match;

    while ((match = calloutRe.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'callout', content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    if (!parts.length && text) {
      parts.push({ type: 'text', content: text });
    }

    return parts;
  }

  function render(body) {
    const raw = String(body || '');
    if (!raw.trim()) return '';

    const parts = splitCallouts(raw);
    return parts
      .map((part) =>
        part.type === 'callout' ? renderCallout(part.content) : renderBlocks(part.content)
      )
      .join('');
  }

  window.NewsArticleBody = {
    render,
    renderInline,
    renderBlocks,
    normalizeArticleMarkdown,
  };
})();
