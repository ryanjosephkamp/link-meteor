// Shared DOM, formatting and URL helpers for the workbench. They hold no UI state.
export const $ = (id) => document.getElementById(id);

/* Small DOM helpers ------------------------------------------------------- */
export const SVG_NS = 'http://www.w3.org/2000/svg';
export function node(tag, className, value) { const item = document.createElement(tag); if (className) item.className = className; if (value !== undefined) item.textContent = value; return item; }
export function icon(name, className = 'icon') { const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(SVG_NS, 'use'); use.setAttribute('href', `#${name}`); svg.append(use); return svg; }
export function button(label, className = 'btn', iconName = '') { const item = node('button', className); item.type = 'button'; if (iconName) item.append(icon(iconName)); item.append(document.createTextNode(label)); return item; }
export function count(n) { return Number(n).toLocaleString(); }
export function plural(n, word, many = `${word}s`) { return `${count(n)} ${n === 1 ? word : many}`; }
export function quoted(value) { return value ? `“${value}”` : 'no anchor text'; }

/* URL and label helpers ----------------------------------------------------- */
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function capturableUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  return url.hostname === 'chromewebstore.google.com' || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) ? '' : safe;
}
export function originOf(value) { const safe = capturableUrl(value); return safe ? new URL(safe).origin : ''; }
export function hostOf(value) { try { return new URL(value).host; } catch { return ''; } }
export function labelFor(link) { return link.anchorText || link.accessibleLabel || '(textless link)'; }
export function tags(value) { return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]; }
export function filename(name) { return (name || 'links').normalize('NFKD').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'links'; }
export const DOCUMENT_TYPES = new Set(['pdf', 'csv', 'tsv', 'xls', 'xlsx', 'ods', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'odp', 'epub', 'json', 'xml', 'zip', 'gz', 'tar', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'tif', 'tiff', 'mp3', 'mp4', 'wav', 'mov', 'webm', 'bib', 'ris']);
// Path suffix after the last dot, when it looks like a file extension (letters first, as the file-type filter expects).
export function fileType(value) {
  try { const match = new URL(value).pathname.match(/\.([a-z][a-z0-9]{0,4})$/i); return match ? match[1].toLowerCase() : ''; } catch { return ''; }
}
export function appendTextLink(parent, value, display = value, className = '') {
  const href = safeUrl(value);
  if (!href) { parent.append(node('span', className, display || '(unavailable)')); return; }
  const link = node('a', className, display);
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  parent.append(link);
}
// Shows the exact URL string, with the host emphasized for scanning.
export function urlParts(value) {
  try {
    const url = new URL(value);
    const prefix = `${url.protocol}//`;
    if (url.host && value.startsWith(prefix + url.host)) return [prefix, url.host, value.slice(prefix.length + url.host.length)];
  } catch { /* shown verbatim */ }
  return ['', '', value];
}
export function renderUrl(parent, value) {
  const [scheme, host, rest] = urlParts(value);
  const href = safeUrl(value);
  const holder = href ? node('a', 'url') : node('span', 'url');
  if (href) { holder.href = href; holder.target = '_blank'; holder.rel = 'noopener noreferrer'; }
  if (scheme) holder.append(node('span', 'scheme', scheme));
  if (host) holder.append(node('span', 'host', host));
  holder.append(document.createTextNode(rest));
  parent.append(holder);
}
export function formatTime(value) {
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? value || '(unknown)' : time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}
export function shortcutKeys(shortcut) {
  if (!shortcut) return [];
  return shortcut.includes('+') ? shortcut.split('+') : [...shortcut];
}
export function kbdGroup(keys) { return keys.map((key) => node('kbd', '', key)); }
