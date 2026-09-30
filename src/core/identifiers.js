// Identifiers found in a link's address (0.5.0): DOI, arXiv ID, PubMed ID, PMC ID and ISBN.
// Pure: derived each time from the address as captured, never stored and never looked up online.

// Crossref's pattern for modern DOIs (it matches almost every registered DOI): 10. with 4 to 9
// digits, a slash, and a suffix of letters, digits and -._;()/:
const DOI = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const ARXIV_NEW = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const ARXIV_OLD = /^([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?$/i;
const TRAILING = /[.,;:'"\]}>]+$/;

function parse(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; }
}
function decode(text) { try { return decodeURIComponent(text); } catch { return text; } }

// Trims what a DOI can't end with: trailing punctuation, an unbalanced closing parenthesis and a
// file extension that belongs to the address, not the DOI.
function tidyDoi(raw) {
  let doi = raw.replace(/\.(pdf|html?|xml|epub)$/i, '');
  for (;;) {
    const before = doi;
    doi = doi.replace(TRAILING, '');
    if (doi.endsWith(')') && (doi.match(/\(/g) || []).length < (doi.match(/\)/g) || []).length) doi = doi.slice(0, -1);
    if (doi === before) return doi;
  }
}

// The first DOI in a piece of text, or ''.
export function doiIn(text) {
  const match = DOI.exec(decode(String(text ?? '')));
  return match ? tidyDoi(match[0]) : '';
}

// An arXiv ID (with its version, if the address has one) in an arXiv address or an arXiv DOI.
function arxivIn(url) {
  if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return '';
  const match = /^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i.exec(decode(url.pathname));
  if (!match) return '';
  const id = match[1];
  return ARXIV_NEW.test(id) || ARXIV_OLD.test(id) ? id : '';
}
function arxivFromDoi(doi) {
  const match = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return match && (ARXIV_NEW.test(match[1]) || ARXIV_OLD.test(match[1])) ? match[1] : '';
}

function pmidIn(url) {
  const host = url.hostname.toLowerCase(), path = url.pathname;
  if (host === 'pubmed.ncbi.nlm.nih.gov') return /^\/(\d{1,9})\/?$/.exec(path)?.[1] || '';
  if (/(^|\.)ncbi\.nlm\.nih\.gov$/.test(host)) return /^\/pubmed\/(\d{1,9})\/?$/.exec(path)?.[1] || '';
  return '';
}
function pmcidIn(url) {
  const host = url.hostname.toLowerCase();
  const path = host === 'pmc.ncbi.nlm.nih.gov' ? /^\/articles\/(PMC\d+)/i.exec(url.pathname)
    : /(^|\.)ncbi\.nlm\.nih\.gov$/.test(host) ? /^\/pmc\/articles\/(PMC\d+)/i.exec(url.pathname)
    : /(^|\.)europepmc\.org$/.test(host) ? /\/(PMC\d+)(\/|$)/i.exec(url.pathname) : null;
  return path ? path[1].toUpperCase() : '';
}

// ISBN-10: weights 10 to 1, sum divisible by 11, check digit 0-9 or X. ISBN-13: 978 or 979,
// weights 1 and 3, sum divisible by 10.
export function isbnValid(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(digits)) {
    const sum = [...digits].reduce((total, char, i) => total + (char === 'X' ? 10 : Number(char)) * (10 - i), 0);
    return sum % 11 === 0 ? digits : '';
  }
  if (/^97[89]\d{10}$/.test(digits)) {
    const sum = [...digits].reduce((total, char, i) => total + Number(char) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? digits : '';
  }
  return '';
}
function isbnIn(url) {
  const segment = /\/isbn\/([0-9X-]{10,17})(?:[/.?]|$)/i.exec(decode(url.pathname));
  if (segment) return isbnValid(segment[1]);
  for (const [key, text] of url.searchParams) {
    const name = key.toLowerCase();
    if (name === 'isbn' || name === 'ean') { const found = isbnValid(text); if (found && (name === 'isbn' || found.length === 13)) return found; }
    if (name === 'vid') { const found = /^ISBN([0-9X-]{10,17})$/i.exec(text); if (found) return isbnValid(found[1]); }
  }
  return '';
}

// A DOI in the address: doi.org and dx.doi.org paths, /doi/ paths, doi= values, and otherwise
// anywhere in the path or query, as publishers put them.
function doiInUrl(url) {
  if (/^(dx\.)?doi\.org$/i.test(url.hostname)) return doiIn(url.pathname.slice(1));
  for (const [key, text] of url.searchParams) if (key.toLowerCase() === 'doi') { const found = doiIn(text); if (found) return found; }
  return doiIn(url.pathname) || doiIn(url.search);
}

function addressIdentifiers(link) {
  const found = {};
  for (const address of [link?.url, link?.originalHref]) {
    const url = parse(address);
    if (!url) continue;
    found.doi ||= doiInUrl(url);
    found.arxiv ||= arxivIn(url);
    found.pmid ||= pmidIn(url);
    found.pmcid ||= pmcidIn(url);
    found.isbn ||= isbnIn(url);
  }
  return found;
}

// {doi?, arxiv?, pmid?, pmcid?, isbn?} for a link, from its url and originalHref, and from the
// citation it uses (citationFor) when Link Meteor read that page (pages is the collection's page
// citations).
export function identifiersOf(link, pages = {}) {
  const found = addressIdentifiers(link);
  const own = citationFor(link, pages, found)?.citation;
  if (own) {
    found.doi ||= doiIn(own.doi || '');
    if (!found.arxiv && (ARXIV_NEW.test(own.arxiv || '') || ARXIV_OLD.test(own.arxiv || ''))) found.arxiv = own.arxiv;
    found.pmid ||= /^\d{1,9}$/.test(own.pmid || '') ? own.pmid : '';
    found.isbn ||= isbnValid(own.isbn || '');
  }
  found.arxiv ||= arxivFromDoi(found.doi || '');
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value));
}

function pageKeyOf(value) {
  const url = parse(value);
  if (!url) return '';
  url.hash = '';
  return url.href;
}

/* The citation a link uses (0.5.0 RC2) --------------------------------------------------------
   Its own page's citation when Link Meteor read that page. Otherwise one borrowed from a saved
   page about the same work: a page that names the link's address as its PDF (citation_pdf_url),
   or one with the same DOI or the same arXiv ID, ignoring the version. A page's DOI and arXiv ID
   come from its tags or its own address. When several pages match, the newest reading wins. */
const arxivBase = (id) => String(id || '').replace(/v\d+$/i, '').toLowerCase();
const arxivValid = (id) => (ARXIV_NEW.test(id || '') || ARXIV_OLD.test(id || '') ? id : '');

const indexes = new WeakMap();
function pageIndex(pages) {
  let index = indexes.get(pages);
  if (index) return index;
  index = { pdf: new Map(), doi: new Map(), arxiv: new Map() };
  const newestFirst = Object.entries(pages).sort(([, a], [, b]) => String(b?.readAt || '').localeCompare(String(a?.readAt || '')));
  for (const [key, page] of newestFirst) {
    if (!page || typeof page !== 'object') continue;
    const add = (map, value) => { if (value && !map.has(value)) map.set(value, key); };
    const url = parse(key);
    const doi = doiIn(page.doi || '') || (url ? doiInUrl(url) : '');
    add(index.pdf, pageKeyOf(page.pdfUrl));
    add(index.doi, doi.toLowerCase());
    add(index.arxiv, arxivBase(arxivValid(page.arxiv) || (url ? arxivIn(url) : '') || arxivFromDoi(doi)));
  }
  indexes.set(pages, index);
  return index;
}

// {key, citation, reason} with reason 'own', 'pdf', 'doi' or 'arxiv'; or null. ids: the link's
// address identifiers, when the caller already has them.
export function citationFor(link, pages = {}, ids = null) {
  if (!pages || typeof pages !== 'object') return null;
  const own = pageKeyOf(link?.url);
  if (own && pages[own]) return { key: own, citation: pages[own], reason: 'own' };
  if (!own || !Object.keys(pages).length) return null;
  const index = pageIndex(pages), found = ids || addressIdentifiers(link);
  const pick = (reason, key) => (key && key !== own && pages[key] ? { key, citation: pages[key], reason } : null);
  return pick('pdf', index.pdf.get(own))
    || pick('doi', found.doi && index.doi.get(found.doi.toLowerCase()))
    || pick('arxiv', found.arxiv && index.arxiv.get(arxivBase(found.arxiv)))
    || null;
}

// [year, month] from an arXiv ID, whose first four digits are the year and month it was first
// submitted: 2409.11211 is September 2024, and hep-th/9901001 January 1999. [] otherwise.
export function arxivDate(id) {
  const match = /^(\d{2})(\d{2})\.\d{4,5}(v\d+)?$/.exec(id || '') || /\/(\d{2})(\d{2})\d{3}(v\d+)?$/.exec(id || '');
  if (!match) return [];
  const year = Number(match[1]), month = Number(match[2]);
  if (month < 1 || month > 12) return [];
  return [ARXIV_NEW.test(id) ? 2000 + year : year >= 91 ? 1900 + year : 2000 + year, month];
}

// Labels, in display order.
export const IDENTIFIER_LABELS = Object.freeze({ doi: 'DOI', arxiv: 'arXiv', pmid: 'PubMed', pmcid: 'PMC', isbn: 'ISBN' });
