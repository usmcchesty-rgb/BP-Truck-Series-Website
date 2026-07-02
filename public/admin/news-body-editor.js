(function () {
  function getBodyField() {
    return document.getElementById('body');
  }

  function getPreviewPanel() {
    return document.getElementById('bodyPreviewPanel');
  }

  function getPreviewMount() {
    return document.getElementById('bodyPreview');
  }

  function insertText(textarea, text, selectionStart, selectionEnd) {
    const start = selectionStart ?? textarea.selectionStart;
    const end = selectionEnd ?? textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = `${before}${text}${after}`;
    const cursor = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrapSelection(before, after, placeholder) {
    const textarea = getBodyField();
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || placeholder;
    const text = `${before}${selected}${after}`;
    textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function prefixSelectedLines(prefixBuilder) {
    const textarea = getBodyField();
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = value.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');

    const prefixed = lines
      .map((line, index) => {
        if (!line.trim()) return line;
        const prefix = typeof prefixBuilder === 'function' ? prefixBuilder(index, line) : prefixBuilder;
        if (line.startsWith(prefix)) return line;
        return `${prefix}${line}`;
      })
      .join('\n');

    textarea.value = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertBlock(text) {
    const textarea = getBodyField();
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const needsLeadingBreak = start > 0 && value[start - 1] !== '\n';
    const insertion = `${needsLeadingBreak ? '\n\n' : ''}${text}`;
    insertText(textarea, insertion, start, end);
  }

  function applyFormat(type) {
    switch (type) {
      case 'bold':
        wrapSelection('**', '**', 'text');
        break;
      case 'italic':
        wrapSelection('*', '*', 'text');
        break;
      case 'heading':
        insertBlock('## Heading\n\n');
        break;
      case 'quote':
        prefixSelectedLines('> ');
        break;
      case 'bullet':
        prefixSelectedLines('- ');
        break;
      case 'numbered':
        prefixSelectedLines((index) => `${index + 1}. `);
        break;
      case 'link':
        wrapSelection('[', '](url)', 'link text');
        break;
      case 'callout':
        insertBlock(':::callout\n**BP NOTE:** Important note here.\n:::\n\n');
        break;
      default:
        break;
    }
    updatePreview();
  }

  function updatePreview() {
    const mount = getPreviewMount();
    const textarea = getBodyField();
    if (!mount || !textarea || !window.NewsArticleBody) return;

    const html = NewsArticleBody.render(textarea.value);
    mount.innerHTML = html
      ? `<div class="news-article-body">${html}</div>`
      : '<p class="muted">Nothing to preview yet.</p>';
  }

  function togglePreview() {
    const panel = getPreviewPanel();
    const button = document.getElementById('bodyPreviewToggle');
    if (!panel) return;

    const show = panel.hidden;
    panel.hidden = !show;
    if (button) button.textContent = show ? 'Hide Preview' : 'Show Preview';
    if (show) updatePreview();
  }

  function bindToolbar() {
    const toolbar = document.querySelector('.editor-format-toolbar');
    if (toolbar?.dataset.bound === '1') return;
    if (toolbar) toolbar.dataset.bound = '1';

    document.querySelectorAll('[data-body-format]').forEach((button) => {
      button.addEventListener('click', () => applyFormat(button.dataset.bodyFormat));
    });

    document.getElementById('bodyPreviewToggle')?.addEventListener('click', togglePreview);
    getBodyField()?.addEventListener('input', updatePreview);

    const panel = getPreviewPanel();
    if (panel && !panel.hidden) updatePreview();
  }

  window.NewsBodyEditor = {
    init: bindToolbar,
    updatePreview,
    applyFormat,
  };
})();
