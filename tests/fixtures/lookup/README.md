# Recorded lookup answers

Real answers from the three services Page details lookup uses, recorded on 2026-10-02 and used by `tests/lookup.test.mjs` and `tests/lookup-browser.mjs`. No test contacts these services.

| File | Request |
| --- | --- |
| `crossref-article.json` | `GET https://api.crossref.org/works/10.1371/journal.pmed.0020124` |
| `crossref-chapter.json` | `GET https://api.crossref.org/works/10.1007/978-3-031-72627-9_18` |
| `crossref-missing.txt` | `GET https://api.crossref.org/works/10.5555/not-a-real-doi-link-meteor` (404) |
| `datacite-arxiv.json` | `GET https://api.datacite.org/dois/10.48550/arXiv.2409.11211` |
| `datacite-missing.json` | `GET https://api.datacite.org/dois/10.5555/not-a-real-doi-link-meteor` (404) |
| `pubmed-article.json` | `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=16060722` |

Each is the answer as received, re-indented, with bulky parts Link Meteor never reads removed (reference lists, license and funding records, counts over time). Crossref and DataCite publish this metadata under CC0; NCBI's is in the public domain.
