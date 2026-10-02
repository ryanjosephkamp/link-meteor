// The only part of Link Meteor that can reach the network (0.6.0): a sandboxed page, shown in a
// hidden frame while a lookup runs. Its origin is "null": it has no access to collections,
// storage or Chrome's APIs, and its own policy lets it reach three addresses and nothing else.
// The workbench hands it one identifier at a time; it makes the one request that identifier's
// service takes, and hands back the answer. It builds the address itself from a checked
// identifier, so nothing else can be requested through it. The same shapes are in
// core/lookup.js, and the contract is in docs/CONTRACTS.md ("Page details lookup").
(() => {
  const DOI = /^10\.\d{4,9}\/\S+$/u, PMID = /^\d{1,9}$/u;
  const SERVICES = {
    crossref: { shape: DOI, url: (doi) => `https://api.crossref.org/works/${encodeURIComponent(doi)}` },
    datacite: { shape: DOI, url: (doi) => `https://api.datacite.org/dois/${encodeURIComponent(doi)}` },
    pubmed: { shape: PMID, url: (pmid) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}` },
  };
  const MAX_ANSWER = 2 * 1024 * 1024;
  const home = location.ancestorOrigins?.[0] || '*';
  addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'lookup') return;
    const { id, service, identifier } = event.data;
    const reply = (answer) => parent.postMessage({ type: 'lookup.answer', id, ...answer }, home);
    const target = Object.hasOwn(SERVICES, service) ? SERVICES[service] : null;
    if (!target || typeof identifier !== 'string' || identifier.length > 300 || !target.shape.test(identifier)) { reply({ error: 'Link Meteor looks up only a DOI, an arXiv ID or a PubMed ID.' }); return; }
    try {
      // No cookies are sent or kept, and there is no referrer. The origin of a sandboxed page is "null".
      const response = await fetch(target.url(identifier), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      const body = await response.text();
      reply(body.length > MAX_ANSWER ? { error: 'The service’s answer was too large to read.' } : { status: response.status, body });
    } catch { reply({ error: 'The lookup couldn’t reach the service.' }); }
  });
  parent.postMessage({ type: 'lookup.ready' }, home);
})();
