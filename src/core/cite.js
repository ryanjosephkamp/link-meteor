// Citation formats (0.5.0): BibTeX, RIS, CSL-JSON, an annotated bibliography and an Obsidian note,
// one entry per row. Pure, and never looks anything up: output depends only on the rows, the
// collection's page citations, its name and custom columns, and the export time given.
import { identifiersOf } from './identifiers.js';

export const CITE_FORMATS = Object.freeze(['bibtex', 'ris', 'csl', 'annotated', 'obsidian']);
export const CITE_MIMES = Object.freeze({
  bibtex: 'application/x-bibtex;charset=utf-8', ris: 'application/x-research-info-systems;charset=utf-8',
  csl: 'application/vnd.citationstyles.csl+json;charset=utf-8', annotated: 'text/markdown;charset=utf-8', obsidian: 'text/markdown;charset=utf-8',
});

/* Shared helpers ------------------------------------------------------------------------------ */
function oneLine(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
function pad(n) { return String(n).padStart(2, '0'); }
// A page's address without its fragment, as the collection's page citations are keyed.
function pageKey(value) {
  try { const url = new URL(value); url.hash = ''; return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function siteName(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; }
}
// The local calendar date of a time, as [year, month, day], or [].
function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? [] : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}
function isoDate([year, month, day]) { return year ? `${year}-${pad(month)}-${pad(day)}` : ''; }

const MONTH = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// [year, month?, day?] from a date as a page printed it: 2025-03-14, 2025/03, 14 March 2025,
// March 14, 2025 or 2019 Aug 23. Day-first or month-first numbers (03/04/2025) give only the year.
export function dateParts(text) {
  const value = oneLine(text);
  let year, month, day;
  const numeric = /(?<!\d)(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?!\d)/.exec(value);
  if (numeric) [year, month, day] = numeric.slice(1).map((n) => n && Number(n));
  else {
    const found = /(?<!\d)(\d{4})(?!\d)/.exec(value);
    if (!found) return [];
    year = Number(found[1]);
    const name = MONTH.exec(value);
    if (name) {
      month = MONTHS.indexOf(name[1].slice(0, 3).toLowerCase()) + 1;
      const after = /^\s*(\d{1,2})(?:st|nd|rd|th)?(?!\d)/i.exec(value.slice(name.index + name[0].length));
      const before = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\.?\s*$/i.exec(value.slice(0, name.index));
      day = Number((after || before)?.[1]) || undefined;
    }
  }
  if (!(year >= 1000 && year <= 2999)) return [];
  if (!(month >= 1 && month <= 12)) return [year];
  if (!(day >= 1 && new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day)) return [year, month];
  return [year, month, day];
}

// {family, given} for a name printed "Family, Given"; any other name stays whole.
function personName(name) {
  const parts = name.split(',');
  if (parts.length !== 2) return null;
  const [family, given] = parts.map(oneLine);
  return family && given ? { family, given } : null;
}

// What every format needs from one row. Titles come from the link's own page citation, then its
// anchor text, accessible label or address; authors, dates, journals and pages only from its own
// citation.
function entryOf(row, pages) {
  const own = pages[pageKey(row.url)] || {};
  const anchor = oneLine(row.anchorText) || oneLine(row.accessibleLabel);
  const url = String(row.url ?? '');
  const title = oneLine(own.title) || anchor || url;
  const date = oneLine(own.date);
  const [year, month, day] = dateParts(date);
  const firstPage = oneLine(own.firstPage);
  const lastPage = firstPage && oneLine(own.lastPage) !== firstPage ? oneLine(own.lastPage) : '';
  return {
    row, url, title, fromPage: !!oneLine(own.title), fromAddress: !oneLine(own.title) && !anchor, anchor, date, year, month, day,
    authors: (Array.isArray(own.authors) ? own.authors : []).map(oneLine).filter(Boolean),
    journal: oneLine(own.journal), volume: oneLine(own.volume), issue: oneLine(own.issue), firstPage, lastPage,
    ids: identifiersOf(row, pages), accessed: localDate(row.capturedAt),
    note: String(row.notes ?? '').trim(), tags: (Array.isArray(row.tags) ? row.tags : []).map(oneLine).filter(Boolean), context: oneLine(row.context),
  };
}
function pageRange(entry, dash) { return entry.firstPage + (entry.lastPage ? dash + entry.lastPage : ''); }

/* Keys: the first author's family name or the title's first word, plus the year, made unique
   with a, b… A name not printed "Family, Given" gives its last word. */
const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };
function keyWord(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[ßæœøłđðþı]/g, (c) => FOLD[c]).replace(/[^a-z0-9]+/g, '');
}
function keyBase(entry) {
  const first = entry.authors[0];
  let word = first ? keyWord(personName(first)?.family ?? first.split(' ').at(-1)) : '';
  if (!word && entry.fromAddress) word = keyWord(siteName(entry.url).split('.')[0]);
  if (!word) {
    const words = entry.title.split(/[\s\-–—/:;,.!?()[\]{}"“”'‘’]+/).map(keyWord).filter(Boolean);
    word = words.find((item) => !['a', 'an', 'the'].includes(item) && /[a-z]/.test(item)) || words[0] || '';
  }
  return (word || 'link') + (entry.year || '');
}
function letters(n) { let text = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(97 + ((n - 1) % 26)) + text; return text; }
function citeKeys(entries) {
  const used = new Set(), next = new Map();
  return entries.map((entry) => {
    const base = keyBase(entry);
    let key = base, i = next.get(base) || 0;
    while (used.has(key)) key = base + letters(i++);
    next.set(base, i);
    used.add(key);
    return key;
  });
}

/* BibTeX, as Zotero writes it ------------------------------------------------------------------ */
// # $ % & _ get a backslash; \ ~ ^ < > | become text macros; braces are escaped with a balancing
// \vphantom, so every field keeps balanced braces. url and doi stay raw.
const TEX = { '|': '{\\textbar}', '<': '{\\textless}', '>': '{\\textgreater}', '~': '{\\textasciitilde}', '^': '{\\textasciicircum}',
  '\\': '{\\textbackslash}', '{': '\\{\\vphantom{\\}}', '}': '\\vphantom{\\{}\\}' };
function tex(value) { return oneLine(value).replace(/[|<>~^\\{}]/g, (c) => TEX[c]).replace(/[#$%&_]/g, '\\$&'); }
// A raw field can't hold a brace or backslash without unbalancing the entry: those are percent-encoded.
function raw(value) { return oneLine(value).replace(/[{}\\\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`); }
function bibName(name) {
  const person = personName(name);
  if (!person) return `{${tex(name)}}`;
  const part = (text) => (/\band\b/i.test(text) ? `{${tex(text)}}` : tex(text));
  return `${part(person.family)}, ${part(person.given)}`;
}
function bibtexEntry(entry, key) {
  const { ids } = entry;
  const fields = [
    ['title', tex(entry.title)], ['author', entry.authors.map(bibName).join(' and ')], ['year', entry.year ? String(entry.year) : ''],
    ['journal', tex(entry.journal)], ['volume', tex(entry.volume)], ['number', tex(entry.issue)], ['pages', tex(pageRange(entry, '--'))],
    ['doi', raw(ids.doi)], ['eprint', tex(ids.arxiv)], ['archivePrefix', ids.arxiv ? 'arXiv' : ''], ['isbn', tex(ids.isbn)],
    ['url', raw(entry.url)], ['urldate', isoDate(entry.accessed)], ['note', tex(entry.note)], ['keywords', tex(entry.tags.join(', '))],
  ].filter(([, value]) => value);
  return `@${entry.journal ? 'article' : 'misc'}{${key},\n${fields.map(([name, value]) => `  ${name.padEnd(12)} = {${value}}`).join(',\n')}\n}`;
}

/* RIS: two-letter tags, two spaces, a hyphen and a space; CRLF line endings. -------------------- */
function risDate([year, month, day]) { return year && month ? `${year}/${pad(month)}/${day ? pad(day) : ''}/` : ''; }
function risRecord(entry) {
  const { ids } = entry;
  const lines = [
    ['TY', entry.journal ? 'JOUR' : 'ELEC'], ['TI', entry.title], ...entry.authors.map((name) => ['AU', name]),
    ['PY', entry.year ? String(entry.year) : ''], ['DA', risDate([entry.year, entry.month, entry.day])], ['T2', entry.journal],
    ['VL', entry.volume], ['IS', entry.issue], ['SP', entry.firstPage], ['EP', entry.lastPage], ['DO', ids.doi], ['UR', entry.url],
    ['Y2', entry.accessed.length ? `${entry.accessed[0]}/${pad(entry.accessed[1])}/${pad(entry.accessed[2])}/` : ''], ['N1', entry.note],
    ...entry.tags.map((tag) => ['KW', tag]),
  ];
  return [...lines.map(([tag, value]) => [tag, oneLine(value)]).filter(([, value]) => value).map(([tag, value]) => `${tag}  - ${value}`), 'ER  - '].join('\r\n');
}

/* CSL-JSON --------------------------------------------------------------------------------------- */
// A web page's container is its site, except for DOI resolvers, which aren't where the page lives.
const RESOLVERS = /^(dx\.)?doi\.org$/;
// Indented like the rest of the file, but each date on one line: [[2025, 3, 14]].
function cslJson(value) {
  return JSON.stringify(value, null, 2).replace(/\[\n\s*\[\n([\d,\s]+?)\n\s*\]\n\s*\]/g, (_, parts) => `[[${parts.split(',').map((part) => part.trim()).join(', ')}]]`);
}
function cslItem(entry, key) {
  const { ids } = entry;
  const item = { id: key, type: entry.journal ? 'article-journal' : 'webpage', title: entry.title };
  if (entry.authors.length) item.author = entry.authors.map((name) => { const person = personName(name); return person ? { family: person.family, given: person.given } : { literal: name }; });
  if (entry.year) item.issued = { 'date-parts': [[entry.year, entry.month, entry.day].filter(Boolean)] };
  else if (entry.date) item.issued = { literal: entry.date };
  const site = siteName(entry.url);
  const values = {
    'container-title': entry.journal || (RESOLVERS.test(site) ? '' : site), volume: entry.volume, issue: entry.issue, page: pageRange(entry, '-'),
    DOI: ids.doi, PMID: ids.pmid, PMCID: ids.pmcid, ISBN: ids.isbn, URL: entry.url,
  };
  for (const [name, value] of Object.entries(values)) if (value) item[name] = value;
  if (entry.accessed.length) item.accessed = { 'date-parts': [entry.accessed] };
  if (entry.note) item.note = entry.note;
  if (entry.tags.length) item.keyword = entry.tags.join(', ');
  return item;
}

/* Markdown: the annotated bibliography and the Obsidian note ----------------------------------- */
// Page text and notes are escaped so they read as written, never as formatting, links, tags,
// highlights, comments or math in Obsidian.
function mdText(value) {
  return oneLine(value).replace(/[\\`*_[\]<>#|~$]/g, '\\$&').replace(/==/g, '=\\=').replace(/%%/g, '%\\%')
    .replace(/^([-+=])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
}
function percent(c) { return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`; }
function autolink(url) { return `<${url.replace(/[<>\s]/g, percent)}>`; }
function linkUrl(url) { return url.replace(/[<>()[\]\\\s]/g, percent); }
function noteLines(note) { return note.split(/\r\n|\r|\n/).map(oneLine).filter(Boolean); }

function citationLine(entry) {
  const link = autolink(entry.ids.doi ? `https://doi.org/${entry.ids.doi}` : entry.url);
  if (entry.fromAddress) return link;
  const title = mdText(entry.title) + (/[.?!]$/.test(entry.title) ? '' : '.');
  const year = entry.year ? `(${entry.year})` : '';
  const lead = entry.authors.length ? `${mdText(entry.authors.join('; '))}${year ? ` ${year}` : ''}. ${title}` : `${title}${year ? ` ${year}.` : ''}`;
  const numbers = [entry.volume && mdText(entry.volume) + (entry.issue ? `(${mdText(entry.issue)})` : ''), !entry.volume && entry.issue && `(${mdText(entry.issue)})`, entry.firstPage && mdText(pageRange(entry, '–'))].filter(Boolean);
  const source = entry.journal ? ` *${mdText(entry.journal)}*${numbers.length ? `, ${numbers.join(', ')}` : ''}.` : '';
  return `${lead}${source} ${link}`;
}
function annotatedEntry(entry, index) {
  const marker = `${index + 1}. `, indent = ' '.repeat(marker.length);
  const blocks = [marker + citationLine(entry), ...noteLines(entry.note).map((line) => indent + mdText(line))];
  if (entry.context) blocks.push(`${indent}> ${mdText(entry.context)}`);
  if (entry.tags.length) blocks.push(`${indent}Tags: ${entry.tags.map(mdText).join(', ')}`);
  return blocks.join('\n\n');
}

// An Obsidian tag: letters, digits, _, - and /, with at least one character that isn't a digit.
function obsidianTag(tag) {
  const clean = tag.replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/^[-/]+|[-/]+$/g, '');
  return /[^\d]/.test(clean) ? clean : '';
}
function fieldName(name) { return oneLine(name).replace(/::+/g, ':').replace(/^([-+*=#>|])/, '\\$1'); }
function obsidianItem(entry, fields) {
  const tags = [...new Set(entry.tags.map(obsidianTag).filter(Boolean))];
  const lines = [`- [${mdText(entry.anchor || entry.title)}](${linkUrl(entry.url)})${tags.map((tag) => ` #${tag}`).join('')}`];
  for (const line of noteLines(entry.note)) lines.push(`  ${mdText(line)}`);
  for (const field of fields) {
    const value = oneLine(entry.row.fields?.[field.id]);
    if (value) lines.push(`  ${fieldName(field.name)}:: ${value}`);
  }
  if (entry.context) lines.push(`  > ${mdText(entry.context)}`);
  return lines.join('\n');
}
function yamlString(value) { return JSON.stringify(String(value)).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`); }
function obsidianNote(entries, items, { collection, date }) {
  const tags = new Map();
  for (const entry of entries) for (const tag of entry.tags.map(obsidianTag).filter(Boolean)) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  const created = date ? `${isoDate(localDate(date))}T${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
  const front = ['---', `title: ${yamlString(oneLine(collection) || 'Links')}`, ...(created ? [`created: ${created}`] : []),
    ...(tags.size ? ['tags:', ...[...tags.values()].map((tag) => `  - ${yamlString(tag)}`)] : ['tags: []']), 'source: Link Meteor', '---'];
  return `${front.join('\n')}\n${items.length ? `\n${items.join('\n')}\n` : ''}`;
}

/* Files ------------------------------------------------------------------------------------------ */
function checkOptions({ format, pages = {}, fields = [], collection = '', date } = {}) {
  if (!CITE_FORMATS.includes(format)) throw new Error(`Unsupported citation format: ${format}`);
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) throw new Error('Citation pages must be an object');
  if (!Array.isArray(fields)) throw new Error('Citation fields must be an array');
  if (date !== undefined && (!(date instanceof Date) || Number.isNaN(date.valueOf()))) throw new Error('Citation date must be a valid date');
  return { format, pages, fields, collection: String(collection ?? ''), date };
}
function entriesOf(rows, options, first = false) {
  const entries = (first ? rows.slice(0, 1) : rows).map((row) => entryOf(row, options.pages));
  const keys = citeKeys(entries);
  switch (options.format) {
    case 'bibtex': return { entries, texts: entries.map((entry, i) => bibtexEntry(entry, keys[i])) };
    case 'ris': return { entries, texts: entries.map(risRecord) };
    case 'csl': return { entries, items: entries.map((entry, i) => cslItem(entry, keys[i])) };
    case 'annotated': return { entries, texts: entries.map(annotatedEntry) };
    case 'obsidian': return { entries, texts: entries.map((entry) => obsidianItem(entry, options.fields)) };
  }
}

// The whole file for rows in one citation format. options: {format, pages, fields, collection, date}.
export function citations(rows, options) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const checked = checkOptions(options);
  const { entries, texts, items } = entriesOf(rows, checked);
  switch (checked.format) {
    case 'bibtex': return texts.length ? `${texts.join('\n\n')}\n` : '';
    case 'ris': return texts.map((text) => `${text}\r\n`).join('\r\n');
    case 'csl': return `${cslJson(items)}\n`;
    case 'annotated': {
      const on = checked.date ? ` on ${isoDate(localDate(checked.date))}` : '';
      const intro = `An annotated bibliography of ${rows.length} ${rows.length === 1 ? 'link' : 'links'}, exported from Link Meteor${on}.`;
      return `# ${mdText(checked.collection) || 'Links'}\n\n${intro}\n${texts.map((text) => `\n${text}\n`).join('')}`;
    }
    case 'obsidian': return obsidianNote(entries, texts, checked);
  }
}

// The first entry exactly as the file writes it (for CSL-JSON, the first item on its own).
export function citeFirst(rows, options) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!rows.length) return '';
  const { texts, items } = entriesOf(rows, checkOptions(options), true);
  return items ? cslJson(items[0]) : texts[0];
}

// What the entries hold, for the Export panel: how many have a DOI or arXiv ID, authors and a
// date, a title from the page itself, only their address as a title, a note and context.
export function citeFacts(rows, pages = {}) {
  const facts = { entries: rows.length, identified: 0, authorsAndDate: 0, pageTitles: 0, addressTitles: 0, notes: 0, contexts: 0 };
  for (const row of rows) {
    const entry = entryOf(row, pages);
    if (entry.ids.doi || entry.ids.arxiv) facts.identified++;
    if (entry.authors.length && entry.year) facts.authorsAndDate++;
    if (entry.fromPage) facts.pageTitles++;
    else if (entry.fromAddress) facts.addressTitles++;
    if (entry.note) facts.notes++;
    if (entry.context) facts.contexts++;
  }
  return facts;
}
