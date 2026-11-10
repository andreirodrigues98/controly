// Sanitizacao allowlist: nunca transferir atributos/eventos de HTML nao confiavel.
// Aceita a formatacao usada nas notas; remove links, midia, scripts e estilos nao permitidos.
const SAFE_ELEMENTS = new Set(['strong', 'b', 'em', 'i', 'br', 'span', 'div', 'p', 'ul', 'ol', 'li']);
const DISCARD_ELEMENTS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'input', 'button', 'link', 'meta']);

function safeTextColor(style) {
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style || '');
  if (!match) return '';
  const value = match[1].trim();
  const valid = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    || /^rgba?\([0-9.,%\s]+\)$/i.test(value)
    || ['inherit', 'currentcolor'].includes(value.toLowerCase());
  return valid ? `color:${value}` : '';
}

export function sanitizeRichText(value = '') {
  // DOMParser cria um documento inerte; os elementos originais nunca sao anexados ao DOM.
  const source = new DOMParser().parseFromString(String(value || ''), 'text/html');
  const target = document.createElement('div');
  function appendSanitized(node, parent) {
    if (node.nodeType === 3) {
      parent.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (DISCARD_ELEMENTS.has(tag)) return;
    if (!SAFE_ELEMENTS.has(tag)) {
      [...node.childNodes].forEach((child) => appendSanitized(child, parent));
      return;
    }
    const clean = document.createElement(tag);
    const color = safeTextColor(node.getAttribute('style'));
    if (color) clean.setAttribute('style', color);
    [...node.childNodes].forEach((child) => appendSanitized(child, clean));
    parent.appendChild(clean);
  }
  [...source.body.childNodes].forEach((node) => appendSanitized(node, target));
  return target.innerHTML.trim();
}
