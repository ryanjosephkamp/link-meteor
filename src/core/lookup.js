// Page details lookup (0.6.0), pure: which request an identifier needs, and each service's answer
// as a page citation. Nothing here contacts anything: the sandboxed frame (ui/lookup-frame.js)
// makes the request, and only for the identifiers and services named here. Answers are untrusted
// text: tags are removed and every field is cut to the model's limits. The contract is in
// docs/CONTRACTS.md ("Page details lookup").
import { MAX_AUTHOR, MAX_AUTHORS } from './model.js';

// The three services, and the one request each can receive.
export const LOOKUP_SERVICES = Object.freeze({
  crossref: { name: 'Crossref', host: 'api.crossref.org', url: (doi) => `https://api.crossref.org/works/${encodeURIComponent(doi)}` },
  datacite: { name: 'DataCite', host: 'api.datacite.org', url: (doi) => `https://api.datacite.org/dois/${encodeURIComponent(doi)}` },
  pubmed: { name: 'NCBI', host: 'eutils.ncbi.nlm.nih.gov', url: (pmid) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}` },
});
// One request at a time, this far apart; at most this many identifiers in one run.
export const LOOKUP_PAUSE_MS = 350, MAX_LOOKUPS = 200;
const DOI = /^10\.\d{4,9}\/\S+$/u, PMID = /^\d{1,9}$/u, ARXIV = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/iu;
const ARXIV_DOI = /^10\.48550\/arxiv\./iu;

// Whether a service may be asked about this identifier: the frame checks the same shapes.
export function lookupAllowed(service, identifier) {
  if (typeof identifier !== 'string' || identifier.length > 300) return false;
  return service === 'pubmed' ? PMID.test(identifier) : (service === 'crossref' || service === 'datacite') && DOI.test(identifier);
}
export const lookupUrl = (service, identifier) => (lookupAllowed(service, identifier) ? LOOKUP_SERVICES[service].url(identifier) : '');

// The requests to try for a link's identifiers ({doi, arxiv, pmid}, as identifiersOf gives them), in
// order, stopping at the first that finds the paper:
// - a DOI goes to Crossref, then to DataCite when Crossref doesn't have it (arXiv's own DOIs go
//   straight to DataCite, which registers them);
// - an arXiv ID without a DOI goes to DataCite as arXiv's DOI for it;
// - a PubMed ID goes to NCBI when there is nothing else.
export function lookupRequests(ids = {}) {
  const requests = [];
  const add = (service, identifier) => { if (lookupAllowed(service, identifier)) requests.push({ service, identifier, url: lookupUrl(service, identifier) }); };
  const arxiv = typeof ids.arxiv === 'string' ? ids.arxiv.replace(/v\d+$/u, '') : '';
  if (ids.doi && ARXIV_DOI.test(ids.doi)) add('datacite', ids.doi);
  else if (ids.doi) { add('crossref', ids.doi); add('datacite', ids.doi); }
  else if (arxiv && ARXIV.test(arxiv)) add('datacite', `10.48550/arXiv.${arxiv}`);
  else if (ids.pmid) add('pubmed', String(ids.pmid));
  return requests;
}

/* Answers ----------------------------------------------------------------------------------------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Text from a service, made plain: tags and entities removed, spaces collapsed, cut to a limit.
export function plainText(value, max = 300) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).replace(/<[^>]*>/gu, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/giu, (whole, name) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 31 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    })
    .replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
const first = (value) => (Array.isArray(value) ? value[0] : value);
const pad = (n) => String(n).padStart(2, '0');
function names(list, read) {
  if (!Array.isArray(list)) return [];
  return list.map(read).map((name) => plainText(name, MAX_AUTHOR)).filter(Boolean).slice(0, MAX_AUTHORS);
}
function fields(entries) {
  const citation = {};
  for (const [key, value, max] of entries) {
    if (key === 'authors') { if (value.length) citation.authors = value; continue; }
    const text = plainText(value, max);
    if (text) citation[key] = text;
  }
  return citation;
}
function pages(value) {
  const [firstPage, lastPage] = plainText(value, 80).split(/\s*[-–—]\s*/u);
  return { firstPage: firstPage || '', lastPage: lastPage && lastPage !== firstPage ? lastPage : '' };
}

// Crossref's answer for a DOI ({message}), as a page citation, or null when it names no work.
export function readCrossref(answer) {
  const work = answer?.message;
  if (!work || typeof work !== 'object' || !plainText(first(work.title))) return null;
  const date = (work.issued || work.published || work['published-print'] || work['published-online'])?.['date-parts']?.[0];
  const [year, month, day] = Array.isArray(date) ? date.map(Number) : [];
  const range = pages(work.page);
  const book = /^book/u.test(String(work.type || ''));
  return { ...fields([
    ['title', first(work.title)],
    ['authors', names(work.author, (author) => (author?.family && author?.given ? `${author.family}, ${author.given}` : author?.family || author?.name || ''))],
    ['date', year >= 1000 ? [year, month >= 1 && month <= 12 ? pad(month) : '', month && day >= 1 && day <= 31 ? pad(day) : ''].filter(Boolean).join('-') : '', 40],
    // A chapter's book is its last container title; a journal article has one.
    ['journal', Array.isArray(work['container-title']) ? work['container-title'].at(-1) : work['container-title']],
    ['publisher', work.publisher], ['volume', work.volume], ['issue', work.issue], ['firstPage', range.firstPage], ['lastPage', range.lastPage],
    ['doi', work.DOI], ['isbn', book ? first(work.ISBN) : ''],
  ]), source: 'crossref' };
}

// DataCite's answer for a DOI ({data: {attributes}}), as a page citation, or null.
export function readDatacite(answer) {
  const work = answer?.data?.attributes;
  if (!work || typeof work !== 'object' || !plainText(first(work.titles)?.title)) return null;
  const dates = Array.isArray(work.dates) ? work.dates : [];
  const dated = (type) => plainText(dates.find((item) => item?.dateType === type)?.date, 40);
  // A preprint's date is when it was submitted; anything else, when it was issued.
  const preprint = work.types?.resourceTypeGeneral === 'Preprint';
  const date = ((preprint && dated('Submitted')) || dated('Issued') || dated('Available') || plainText(work.publicationYear, 4)).replace(/T.*$/u, '');
  const arxiv = (Array.isArray(work.identifiers) ? work.identifiers : []).find((item) => item?.identifierType === 'arXiv')?.identifier
    || (ARXIV_DOI.test(String(work.doi || '')) ? String(work.doi).replace(ARXIV_DOI, '') : '');
  const range = pages(work.container?.firstPage ? `${work.container.firstPage}-${work.container.lastPage || ''}` : '');
  return { ...fields([
    ['title', first(work.titles).title],
    ['authors', names(work.creators, (creator) => (creator?.familyName && creator?.givenName ? `${creator.familyName}, ${creator.givenName}` : creator?.name || ''))],
    ['date', date, 40], ['journal', work.container?.title], ['publisher', typeof work.publisher === 'object' ? work.publisher?.name : work.publisher],
    ['volume', work.container?.volume], ['issue', work.container?.issue], ['firstPage', range.firstPage], ['lastPage', range.lastPage],
    ['doi', work.doi], ['arxiv', ARXIV.test(String(arxiv)) ? arxiv : ''],
  ]), source: 'datacite' };
}

// NCBI's summary for a PubMed ID ({result: {[pmid]: …}}), as a page citation, or null.
export function readPubmed(answer, pmid) {
  const work = answer?.result?.[String(pmid)];
  if (!work || typeof work !== 'object' || work.error || !plainText(work.title)) return null;
  const range = pages(work.pages);
  const doi = (Array.isArray(work.articleids) ? work.articleids : []).find((item) => item?.idtype === 'doi')?.value;
  return { ...fields([
    ['title', String(work.title).replace(/\.$/u, '')],
    // PubMed prints "Family Initials": the same name with a comma, which citations read as family and given.
    ['authors', names(work.authors, (author) => { const name = plainText(author?.name, MAX_AUTHOR), cut = /^(.+) (\p{Lu}{1,4})$/u.exec(name); return cut ? `${cut[1]}, ${cut[2]}` : name; })],
    ['date', work.pubdate, 40], ['journal', work.fulljournalname || work.source], ['volume', work.volume], ['issue', work.issue],
    ['firstPage', range.firstPage], ['lastPage', range.lastPage], ['doi', DOI.test(String(doi || '')) ? doi : ''], ['pmid', PMID.test(String(pmid)) ? String(pmid) : ''],
  ]), source: 'pubmed' };
}

// One answer from the frame ({status, body}) as {citation} or {missing: true} (the service doesn't
// have it) or {error} (too many requests, or anything else worth stopping for).
export function readAnswer(service, identifier, { status, body }) {
  if (status === 404) return { missing: true };
  if (status === 429) return { error: `${LOOKUP_SERVICES[service]?.name || 'The service'} asked Link Meteor to slow down, so the lookup stopped here.`, stop: true };
  if (status !== 200) return { error: `${LOOKUP_SERVICES[service]?.name || 'The service'} answered ${status}.` };
  let answer;
  try { answer = JSON.parse(body); } catch { return { error: `${LOOKUP_SERVICES[service]?.name || 'The service'} sent an answer Link Meteor couldn’t read.` }; }
  const citation = service === 'crossref' ? readCrossref(answer) : service === 'datacite' ? readDatacite(answer) : service === 'pubmed' ? readPubmed(answer, identifier) : null;
  return citation ? { citation } : { missing: true };
}

// What a lookup would add to a citation already there: the fields it has that the older one lacks
// (see mergeCitation in the model, which decides what wins). Used to say what changed.
export function filled(older, newer) {
  return Object.keys(newer).filter((key) => !['source', 'readAt'].includes(key) && (key === 'authors' ? !(older?.authors?.length) : !older?.[key]));
}
