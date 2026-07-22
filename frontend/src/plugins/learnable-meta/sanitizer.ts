// Clean-room, dependency-free allowlist for the HTML returned by Learnable Meta.
const ALLOWED = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'a'
]);
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'video', 'audio'
]);

function safeLink(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://learnablemeta.com/');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function copyNode(node: Node, output: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    output.appendChild(document.createTextNode(node.textContent || ''));
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return;
  if (!ALLOWED.has(tag)) {
    for (const child of node.childNodes) copyNode(child, output);
    return;
  }

  const clean = document.createElement(tag);
  if (tag === 'a') {
    const href = safeLink(node.getAttribute('href'));
    if (href) {
      const link = clean as HTMLAnchorElement;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.dataset.lmExternalLink = 'true';
    }
  }
  for (const child of node.childNodes) copyNode(child, clean);
  output.appendChild(clean);
}

export function sanitizeHtml(value: unknown) {
  const template = document.createElement('template');
  template.innerHTML = typeof value === 'string' ? value : '';
  const fragment = document.createDocumentFragment();
  for (const child of template.content.childNodes) copyNode(child, fragment);
  return fragment;
}

export function safeImageUrls(values: unknown) {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 4096) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      result.push(url.href);
    } catch { /* skip malformed URLs */ }
  }
  return result;
}
