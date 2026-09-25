// Link Meteor site behavior. Everything runs locally in the page; nothing is sent anywhere.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* Navigation ---------------------------------------------------------------- */
const toggle = $('.menu-toggle');
const nav = $('#site-nav');
if (toggle && nav) {
  const setOpen = (open) => { nav.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); } });
  matchMedia('(min-width: 861px)').addEventListener('change', () => setOpen(false));
}
const here = location.pathname.split('/').pop() || 'index.html';
for (const link of $$('.nav a')) if (link.getAttribute('href') === here) link.setAttribute('aria-current', 'page');

/* Capture demo -------------------------------------------------------------- */
const page = $('#demo-page');
const selection = { links: [] };
const listeners = new Set();
const onSelection = (fn) => { listeners.add(fn); fn(selection.links); };

function linkRecord(anchor, index) {
  // Mirrors the extension: visible text with whitespace collapsed; image labels go to a separate field.
  const anchorText = anchor.innerText.replace(/\s+/g, ' ').trim();
  const accessibleLabel = anchor.getAttribute('aria-label') || '';
  const capturedAt = new Date().toISOString();
  return {
    id: `demo-${index + 1}`, anchorText, accessibleLabel: anchorText ? '' : accessibleLabel, url: anchor.href,
    originalHref: anchor.getAttribute('href'), sourceUrl: 'https://journal.example.org/reading-lists/uhi',
    sourceTitle: 'Reading list: urban heat islands', frameUrl: 'https://journal.example.org/reading-lists/uhi',
    capturedAt, batchId: 'demo-batch', notes: '', tags: [],
  };
}

if (page) {
  const layer = $('#demo-layer');
  const anchors = $$('#demo-list a');
  const records = anchors.map(linkRecord);
  const count = $('#demo-count');
  const table = $('#demo-table');
  const tbody = $('tbody', table);
  const empty = $('#demo-empty');
  const copy = $('#demo-copy');
  const status = $('#demo-status');
  let rect = null, badge = null, animation = 0, lastHits = [];

  const positive = (r) => r.right > r.left && r.bottom > r.top;
  const intersect = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const local = () => page.getBoundingClientRect();

  function draw(box, pointer) {
    const origin = local();
    layer.replaceChildren();
    if (!box) return [];
    rect = document.createElement('div'); rect.className = 'demo-rect';
    Object.assign(rect.style, { left: `${box.left - origin.left}px`, top: `${box.top - origin.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
    layer.append(rect);
    const hits = [];
    anchors.forEach((anchor, index) => {
      const rects = [...anchor.getClientRects()].filter(positive);
      if (rects.some((r) => positive(intersect(r, box)))) {
        hits.push(index);
        for (const r of rects) {
          const mark = document.createElement('div'); mark.className = 'demo-hit';
          Object.assign(mark.style, { left: `${r.left - origin.left - 2}px`, top: `${r.top - origin.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px` });
          layer.append(mark);
        }
      }
    });
    if (pointer) {
      badge = document.createElement('div'); badge.className = 'demo-badge';
      badge.textContent = `${hits.length} link${hits.length === 1 ? '' : 's'}`;
      const x = Math.min(origin.width - 84, Math.max(4, pointer.x - origin.left + 12));
      const y = Math.min(origin.height - 30, Math.max(4, pointer.y - origin.top + 12));
      Object.assign(badge.style, { left: `${x}px`, top: `${y}px` });
      layer.append(badge);
    }
    return hits;
  }

  function marks(hits) {
    const origin = local();
    layer.replaceChildren();
    for (const index of hits) for (const r of [...anchors[index].getClientRects()].filter(positive)) {
      const mark = document.createElement('div'); mark.className = 'demo-hit';
      Object.assign(mark.style, { left: `${r.left - origin.left - 2}px`, top: `${r.top - origin.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px` });
      layer.append(mark);
    }
  }

  function commit(hits) {
    lastHits = hits;
    selection.links = hits.map((index) => records[index]);
    const n = selection.links.length;
    count.textContent = n ? `${n} link${n === 1 ? '' : 's'} selected` : 'No links in that area';
    tbody.replaceChildren(...selection.links.slice(0, 5).map((link) => {
      const tr = document.createElement('tr');
      const anchor = document.createElement('td'); anchor.textContent = link.anchorText || 'No anchor text';
      if (!link.anchorText) anchor.className = 'empty';
      const url = document.createElement('td'); url.textContent = link.url;
      tr.append(anchor, url); return tr;
    }));
    if (n > 5) { const tr = document.createElement('tr'); tr.className = 'more'; const td = document.createElement('td'); td.colSpan = 2; td.textContent = `and ${n - 5} more`; tr.append(td); tbody.append(tr); }
    table.hidden = !n; empty.hidden = !!n;
    if (!n) empty.textContent = 'Nothing was inside that rectangle. Try dragging across the titles.';
    copy.disabled = !n; status.textContent = '';
    for (const fn of listeners) fn(selection.links);
  }

  const box = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
  let start = null;
  page.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    cancelAnimationFrame(animation);
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    page.setPointerCapture(event.pointerId);
    draw(box(start, start), start);
  });
  page.addEventListener('pointermove', (event) => { if (start) draw(box(start, { x: event.clientX, y: event.clientY }), { x: event.clientX, y: event.clientY }); });
  page.addEventListener('pointerup', (event) => {
    if (!start) return;
    const end = { x: event.clientX, y: event.clientY };
    const moved = Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > 4;
    const hits = moved ? draw(box(start, end)) : [];
    if (!moved) layer.replaceChildren();
    start = null;
    if (moved) commit(hits);
  });
  page.addEventListener('pointercancel', () => { start = null; layer.replaceChildren(); });
  page.addEventListener('click', (event) => {
    if (event.target.closest('a')) { event.preventDefault(); status.textContent = 'Demo links don’t open. On a real page, Link Meteor never opens links while you select.'; }
  });

  function selectAll() {
    cancelAnimationFrame(animation);
    const first = anchors[0].getBoundingClientRect(), last = anchors.at(-1).getBoundingClientRect(), origin = local();
    const hits = draw({ left: origin.left + 12, top: first.top - 6, right: origin.right - 12, bottom: last.bottom + 6 });
    commit(hits);
  }

  function play() {
    cancelAnimationFrame(animation);
    const a = anchors[0].getBoundingClientRect(), d = anchors[3].getBoundingClientRect(), c = anchors[2].getBoundingClientRect(), origin = local();
    const from = { x: origin.left + 18, y: a.top - 8 };
    const to = { x: Math.min(origin.right - 20, c.right + 24), y: d.bottom + 8 };
    if (reduceMotion.matches) { commit(draw(box(from, to))); return; }
    const began = performance.now(), duration = 1500;
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const p = { x: from.x + (to.x - from.x) * ease(t), y: from.y + (to.y - from.y) * ease(t) };
      const hits = draw(box(from, p), p);
      if (t < 1) animation = requestAnimationFrame(step);
      else { animation = 0; draw(box(from, p)); commit(hits); }
    };
    animation = requestAnimationFrame(step);
  }

  $('#demo-all').addEventListener('click', selectAll);
  $('#demo-replay').addEventListener('click', play);
  copy.addEventListener('click', async () => {
    const tsv = ['Anchor text\tURL', ...selection.links.map((link) => `${link.anchorText}\t${link.url}`)].join('\r\n') + '\r\n';
    try { await navigator.clipboard.writeText(tsv); status.textContent = `Copied ${selection.links.length} rows as two columns. Paste into any spreadsheet.`; }
    catch { status.textContent = 'This browser blocked clipboard access for the demo.'; }
  });
  // Highlights are positioned from live link geometry, so redraw them when the layout changes.
  new ResizeObserver(() => { if (!start && !animation) marks(lastHits); }).observe(page);

  const begin = () => setTimeout(play, reduceMotion.matches ? 0 : 700);
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { seen.disconnect(); begin(); } }, { threshold: 0.4 });
    seen.observe(page);
  } else begin();
}

/* Scope diagram -------------------------------------------------------------- */
const scopeItems = $$('.scope-item');
if (scopeItems.length) {
  const groups = $$('#scope-svg [data-scope]');
  const activate = (item) => {
    for (const other of scopeItems) other.classList.toggle('is-active', other === item);
    const scope = item.dataset.scope;
    for (const group of groups) group.classList.toggle('is-active', group.dataset.scope === scope || (scope === 'window' && group.dataset.scope === 'all'));
  };
  for (const item of scopeItems) { item.addEventListener('mouseenter', () => activate(item)); item.addEventListener('focus', () => activate(item)); }
  activate(scopeItems[0]);
}

/* Export viewer -------------------------------------------------------------- */
const exporter = $('#exporter');
if (exporter) {
  const notes = {
    xlsx: ['Excel workbook', 'A real .xlsx file. Every cell is stored as text, so labels are never reinterpreted as formulas, numbers or dates.'],
    csv: ['CSV', 'Quotes, commas and line breaks are escaped. Cells that look like formulas start with an apostrophe so spreadsheets import them as text.'],
    markdown: ['Markdown links', 'One [anchor text](URL) per line. An empty anchor stays empty rather than being filled with the URL.'],
    json: ['JSON with full provenance', 'Every field for every link, including source page, frame, capture time and batch, whichever columns you chose.'],
    html: ['HTML table', 'A plain table using your chosen columns. Text from the page is escaped, so it can never run as markup.'],
    text: ['URL list', 'One URL per line, byte for byte as captured.'],
  };
  const tabs = $$('[role="tab"]', exporter);
  const output = $('#exporter-output');
  let format = 'xlsx', rows = [];
  let makeExport = null;

  async function render() {
    if (!makeExport) {
      try { ({ makeExport } = await import('./core/export.js')); }
      catch { output.textContent = 'The export preview could not load.'; return; }
    }
    const [title, text] = notes[format];
    $('#exporter-note-title').textContent = title;
    $('#exporter-note').textContent = text;
    $('#exporter-download').hidden = format !== 'xlsx' && format !== 'csv';
    if (!rows.length) { output.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Select some links in the demo above to preview them here.' })); return; }
    if (format === 'xlsx') {
      const table = document.createElement('table'); table.className = 'sheet';
      const cell = (tag, text, className = '') => { const item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; };
      const letters = document.createElement('tr'); letters.className = 'colhead';
      letters.append(cell('th', '', 'rownum'), cell('th', 'A'), cell('th', 'B'));
      const header = document.createElement('tr'); header.className = 'header';
      header.append(cell('td', '1', 'rownum'), cell('td', 'Anchor text'), cell('td', 'URL'));
      table.append(letters, header);
      rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.append(cell('td', String(index + 2), 'rownum'), cell('td', row.anchorText, row.anchorText ? '' : 'nil'), cell('td', row.url, 'url'));
        table.append(tr);
      });
      output.replaceChildren(table);
      return;
    }
    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', `${title} output`);
    let text2 = makeExport(rows, { format, columns: ['anchorText', 'url'] }).data;
    if (format === 'json' && text2.length > 6000) text2 = `${text2.slice(0, 6000)}\n…`;
    pre.textContent = text2;
    output.replaceChildren(pre);
  }

  function choose(tab, focus = false) {
    for (const other of tabs) { const on = other === tab; other.setAttribute('aria-selected', String(on)); other.tabIndex = on ? 0 : -1; }
    format = tab.dataset.format;
    if (focus) tab.focus();
    render();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab));
    tab.addEventListener('keydown', (event) => {
      const next = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (next) { event.preventDefault(); choose(tabs[(index + next + tabs.length) % tabs.length], true); }
      if (event.key === 'Home') { event.preventDefault(); choose(tabs[0], true); }
      if (event.key === 'End') { event.preventDefault(); choose(tabs.at(-1), true); }
    });
  });
  $('#exporter-download').addEventListener('click', () => {
    if (!makeExport || !rows.length) return;
    const result = makeExport(rows, { format, columns: ['anchorText', 'url'] });
    const href = URL.createObjectURL(new Blob([result.data], { type: result.mime }));
    const link = Object.assign(document.createElement('a'), { href, download: `link-meteor-sample.${result.extension}` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  });
  onSelection((links) => { rows = links.map((link) => ({ ...link, occurrences: [link], occurrenceIds: [link.id] })); render(); });
}
