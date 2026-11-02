// Page citations (0.5.0): the citation details a page publishes about itself in its own tags, read
// from the page Link Meteor already has open and never looked up online. The page script
// (content/capture.js, pageCitation) reads them when capturing; Save tabs as links reads them with
// readCitationTags below, only where Link Meteor already has access to the tab's site. Both
// readers read the same way (tests/access-content.mjs checks that they agree). The contract is in
// docs/CONTRACTS.md ("Page citations").
import {pageKey, MAX_AUTHORS, MAX_AUTHOR} from '../core/model.js';
import {doiIn} from '../core/identifiers.js';

// Runs in a tab through chrome.scripting.executeScript, so it refers to nothing outside itself. It
// reads, in order, the first of these that gives a title: Highwire Press tags (the ones Google
// Scholar indexes), PRISM (with Dublin Core's title and creators), schema.org JSON-LD, and Dublin
// Core alone. Longer text is cut to the model's limits, longer codes and names are dropped, and
// odd pages (bad JSON-LD, huge values, thousands of authors) are cut or skipped, never an error.
// Returns {title, authors?, date?, …} as printed, or null.
export function readCitationTags() {
  const LONG = 300, DATE = 40, ADDRESS = 2000, AUTHORS = 50, AUTHOR = 200, METAS = 2000, SCRIPTS = 20, JSON_BYTES = 1000000;
  const TYPES = new Set(['ScholarlyArticle', 'MedicalScholarlyArticle', 'Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report', 'Book']);
  const clean = (value) => String(value ?? '').slice(0, 10000).replace(/\s+/gu, ' ').trim();
  const cut = (value, max) => { const text = clean(value); if (text.length <= max) return text; const part = text.slice(0, max - 1); return (part.replace(/\s+\S*$/u, '') || part) + '…'; };
  const code = (value, max) => { const text = clean(value); return text.length <= max ? text : ''; };
  const textOf = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? textOf(value[0]) : value && typeof value === 'object' && '@value' in value ? textOf(value['@value']) : '';
  const doiOf = (value) => /^(?:doi:\s*|info:doi\/|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(clean(value))?.[1] || '';
  try {
    const metas = new Map();
    for (const meta of [...document.querySelectorAll('meta[name][content]')].slice(0, METAS)) {
      const name = meta.getAttribute('name').trim().toLowerCase(), content = clean(meta.getAttribute('content'));
      if (!content) continue;
      if (metas.has(name)) metas.get(name).push(content); else metas.set(name, [content]);
    }
    const all = (...names) => names.flatMap((name) => metas.get(name) || []);
    const first = (...names) => all(...names)[0] || '';
    const dublin = {title: first('dc.title', 'dcterms.title'), authors: all('dc.creator', 'dcterms.creator'), date: first('dc.date', 'dcterms.issued', 'dcterms.date', 'dcterms.created'), publisher: first('dc.publisher', 'dcterms.publisher')};
    const highwire = () => ({title: first('citation_title'), authors: all('citation_author').length ? all('citation_author') : first('citation_authors').split(';'),
      date: first('citation_publication_date', 'citation_date'), journal: first('citation_journal_title'), publisher: first('citation_publisher'),
      volume: first('citation_volume'), issue: first('citation_issue'), firstPage: first('citation_firstpage'), lastPage: first('citation_lastpage'),
      doi: first('citation_doi'), pmid: first('citation_pmid'), arxiv: first('citation_arxiv_id'), isbn: first('citation_isbn'), pdfUrl: first('citation_pdf_url')});
    const prism = () => [...metas.keys()].some((name) => name.startsWith('prism.')) ? {...dublin, date: first('prism.publicationdate', 'prism.coverdate') || dublin.date,
      journal: first('prism.publicationname'), publisher: dublin.publisher || first('prism.publisher'), volume: first('prism.volume'), issue: first('prism.number', 'prism.issueidentifier'),
      firstPage: first('prism.startingpage'), lastPage: first('prism.endingpage'), doi: first('prism.doi'), isbn: first('prism.isbn')} : {};
    const jsonld = () => {
      const nodes = [];
      const visit = (value, depth) => {
        if (depth > 4 || !value || typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const item of value.slice(0, 200)) visit(item, depth + 1); return; }
        nodes.push(value); if (value['@graph']) visit(value['@graph'], depth + 1);
      };
      for (const script of [...document.querySelectorAll('script[type*="ld+json" i]')].slice(0, SCRIPTS)) {
        const text = script.textContent;
        if (text.length > JSON_BYTES) continue;
        try { visit(JSON.parse(text), 0); } catch { /* bad JSON-LD is skipped */ }
      }
      const byId = new Map(nodes.filter((node) => typeof node['@id'] === 'string').map((node) => [node['@id'], node]));
      const deref = (value) => value && typeof value === 'object' && !Array.isArray(value) && typeof value['@id'] === 'string' && Object.keys(value).length === 1 ? byId.get(value['@id']) || value : value;
      const list = (value) => [].concat(value ?? []).slice(0, 1000).map(deref);
      const types = (node) => [].concat(node?.['@type'] ?? []).map((type) => String(type).replace(/^https?:\/\/schema\.org\//, ''));
      const nameOf = (value) => { const node = deref(value); return typeof node === 'string' ? node : node && typeof node === 'object' ? textOf(node.name) || [textOf(node.givenName), textOf(node.familyName)].filter(Boolean).join(' ') : ''; };
      const article = nodes.find((node) => types(node).some((type) => TYPES.has(type)));
      if (!article) return {};
      const found = {title: textOf(article.headline) || textOf(article.name), authors: list(article.author).map(nameOf), date: textOf(article.datePublished) || textOf(article.dateCreated),
        publisher: nameOf(list(article.publisher)[0]), firstPage: textOf(article.pageStart), lastPage: textOf(article.pageEnd), isbn: textOf(article.isbn)};
      // The journal, volume and issue: isPartOf, from an issue to its volume to its periodical.
      for (let part = list(article.isPartOf)[0], depth = 0; part && typeof part === 'object' && depth < 4; part = list(part.isPartOf)[0], depth++) {
        const kinds = types(part);
        if (kinds.includes('PublicationIssue')) found.issue ||= textOf(part.issueNumber);
        if (kinds.includes('PublicationVolume')) found.volume ||= textOf(part.volumeNumber);
        if (kinds.includes('Periodical')) found.journal ||= textOf(part.name);
      }
      // A DOI only from identifier or sameAs.
      for (const value of [...list(article.identifier), ...list(article.sameAs)]) {
        const doi = value && typeof value === 'object' ? (/doi/i.test(textOf(value.propertyID)) ? doiOf(textOf(value.value)) : '') : doiOf(textOf(value));
        if (doi) { found.doi = doi; break; }
      }
      return found;
    };
    const dc = () => ({...dublin, doi: all('dc.identifier', 'dcterms.identifier').map(doiOf).find(Boolean) || ''});
    for (const read of [highwire, prism, jsonld, dc]) {
      let found;
      try { found = read(); } catch { continue; }
      const title = cut(found.title, LONG);
      if (!title) continue;
      const citation = {title};
      const authors = (found.authors || []).map(clean).filter((name) => name && name.length <= AUTHOR).slice(0, AUTHORS);
      if (authors.length) citation.authors = authors;
      for (const [key, value] of [['date', code(found.date, DATE)], ['journal', cut(found.journal, LONG)], ['publisher', cut(found.publisher, LONG)],
        ...['volume', 'issue', 'firstPage', 'lastPage', 'doi', 'pmid', 'arxiv', 'isbn'].map((key) => [key, code(found[key], LONG)])]) if (value) citation[key] = value;
      try { const pdf = new URL(clean(found.pdfUrl), document.baseURI); if (found.pdfUrl && /^https?:$/.test(pdf.protocol) && pdf.href.length <= ADDRESS) citation.pdfUrl = pdf.href; } catch { /* not an address */ }
      return citation;
    }
  } catch { /* an odd page gives no citation */ }
  return null;
}

// A page citation's text fields and their limits, as the model keeps them.
const FIELDS = {title: 300, date: 40, journal: 300, publisher: 300, volume: 300, issue: 300, firstPage: 300, lastPage: 300, doi: 300, pmid: 300, arxiv: 300, isbn: 300, pdfUrl: 2000};
const collapse = (value) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
// Codes as identifiers read them: a bare DOI, PubMed digits and an arXiv ID without "arXiv:".
const NORMAL = {
  doi: (text) => doiIn(text),
  pmid: (text) => /^(?:PMID:?\s*)?(\d{1,9})$/i.exec(text)?.[1] || '',
  arxiv: (text) => text.replace(/^arxiv:\s*/i, ''),
  pdfUrl: (text) => { try { return /^https?:$/.test(new URL(text).protocol) ? text : ''; } catch { return ''; } },
};

// What a reader sent, as a stored PageCitation: known fields only, text within the model's limits
// (a title, journal or publisher is cut; anything else too long is left out), and when it was read.
// Null without a title.
const CUT = new Set(['title', 'journal', 'publisher']);
export function citationEntry(raw, readAt = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (key) => {
    let value = collapse(raw[key]);
    if (value && NORMAL[key]) value = NORMAL[key](value);
    if (value.length > FIELDS[key] && CUT.has(key)) value = value.slice(0, FIELDS[key] - 1).trimEnd() + '…';
    return value.length <= FIELDS[key] ? value : '';
  };
  const title = text('title');
  if (!title) return null;
  const citation = {title};
  const authors = Array.isArray(raw.authors) ? raw.authors.map(collapse).filter((name) => name && name.length <= MAX_AUTHOR).slice(0, MAX_AUTHORS) : [];
  if (authors.length) citation.authors = authors;
  for (const key of Object.keys(FIELDS)) if (key !== 'title' && text(key)) citation[key] = text(key);
  return {...citation, readAt};
}

// {[pageKey(url)]: PageCitation} for links.append's pages, or {} when there is nothing to keep.
export function citationPages(raw, url, readAt) {
  const key = pageKey(url), entry = key && citationEntry(raw, readAt);
  return entry ? {[key]: entry} : {};
}
