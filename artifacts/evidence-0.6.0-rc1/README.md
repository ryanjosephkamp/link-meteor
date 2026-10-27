# Evidence: 0.6.0 release candidate 1 (October 3, 2026)

These results come from 0.6.0 "Beyond one page" release candidate 1 on `claude/0.6.0`. The product source tested is commit `b600587`; the commits after it changed only tests, a test page and documents (`33ed915` is the tree every result below was run on).

No ZIP was packaged at this stage. **Every check passed**: without grants on macOS, Windows and Linux, and after the owner's Allow clicks. On Chrome 116 every suite that can run there passed, one of them on October 2 only (see [`chrome-116/`](chrome-116/README.md)).

## What release candidate 1 adds

- **The links inside PDFs.** *Capture this PDF* on a PDF open in a tab, and *Import links* from a PDF file or a dropped file: each link with its page and the words under it, shown before anything is added. What a PDF says about itself (arXiv's stamp, a DOI, its title) is kept as its citation. PDF.js is shipped inside the extension.
- **Runs.** *Scroll to the end first*, *Follow Next* (20 pages at most) and *Capture their pages…* (20 pages at most, one level deep), each with a counter, Stop, a stated limit, one batch and one Undo.
- **Coverage.** Links inside closed components, and frames from other sites that Link Meteor has access to; the report names the sites it couldn't read and offers *Allow these sites*.
- **Page details lookup,** optional and off by default: only a DOI, an arXiv ID or a PubMed ID is sent, from a sandboxed frame, to Crossref, DataCite or NCBI.
- **PDF files.** The PDFs behind chosen links as one ZIP, or combined into one PDF in an order the person arranges.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check` on `33ed915`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 321 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: PDFs read in Node with the shipped PDF.js, the ZIP writer, the vendored files' hashes, lookup plans and answers, frames joined, runs with a clock the test moves, the new data fields and backup format 4. |
| `access-browser` | 36/36 | [Results](access-browser-results.json). |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| `access-content` | 55/55, simulation | [Results](access-content-results.json). New: closed shadow roots and frames. |
| `coverage-browser` | 11/11 | [Results](coverage-browser-results.json). New suite: closed components and frames from other sites with only the toolbar's access. |
| `scroll-content` | 11/11, simulation | [Results](scroll-content-results.json). New suite: the scroll loop, each cap, Stop, and the page's Next link. |
| `runs-browser` | 12/12 | [Results](runs-browser-results.json). New suite: Follow Next after one real toolbar click, each way it ends, the report and Undo. |
| `pdf-browser` | 13/13 | [Results](pdf-browser-results.json). New suite: the reader inside the extension, and Import links with a PDF file. |
| `pdf-tab-browser` | 15/15 | [Results](pdf-tab-browser-results.json). New suite: a PDF's file through a tab with only the toolbar's access, and *Capture this PDF*. Nothing downloads. |
| `pdf-files-browser` | 14/14 | [Results](pdf-files-browser-results.json). New suite: one ZIP compared byte for byte (also read by Python's `zipfile`), one combined PDF read back, every download in the profile's own folder. |
| `lookup-browser` | 19/19 | [Results](lookup-browser-results.json). New suite. The test answers in the services' place: no test contacts Crossref, DataCite or NCBI. |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). |
| `backup-browser` | 23/23 | [Results](backup-browser-results.json). The 20,000-link backup file it made is not kept here. |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `reading-browser` | 12/12 | [Results](reading-browser-results.json). |
| `imports-browser` | 13/13 | [Results](imports-browser-results.json). New: a PDF beside the other sources. |
| `move-browser` | 6/6 | [Results](move-browser-results.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). |
| `site-check` | Pass | [Results](site-results.json). |
| The site/package sync | Skipped | No 0.6.0 ZIP at this stage. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `33ed915` (workflow run 37133225634), and all passed.

**On Chrome 116**, the oldest supported Chrome, the PDF reader reads and combines PDFs with two small shims, and the lookup frame works. See [`chrome-116/`](chrome-116/README.md) for what ran and what didn't.

## What earlier runs found

- **Windows, a test page.** One link in the closed-components page wrapped onto two lines with Windows' fonts, so a region drew two boxes for it and two suites failed. The page now keeps its links on one line. [Logs](diagnostics/windows-access-content-first-run.txt).
- **Windows, two suites that stopped.** A screenshot in `pdf-files-browser` never came back, and `lookup-browser` opened a link's details just as the list was drawn again. A screenshot is now given 20 seconds and then skipped (it is evidence, not a check), and the lookup suite opens the details until the note shows. [Logs](diagnostics/windows-pdf-files-browser-second-run.txt).
- **The lanes' merge.** Three unit tests were written against one lane's capture pipeline and needed the joined one: a tab was asked twice what it shows (fixed in the product), and a scrolled capture is followed by a second read for the frames.
- **A real bug, found by a test after the merge.** Undo for a lookup said the details had changed, because Chrome's storage returns objects with their keys sorted. Fixed, with a unit test.

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows, in two new profiles. Each request came from the product with an active user gesture. The grant logs are kept on the owner's computer.

- **Per-site profile, 5 prompts:** tabs, the fixture site, bookmarks, downloads, and a newly visited site through *Capture this page*.
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks.
- **Two new prompts, each naming two sites,** in the per-site profile: *Allow these sites* in a capture report (`frames-granted`), and *Allow these 2 sites* in the *Capture their pages…* panel (`runs-granted`). Each suite removed its two grants afterward.

## Granted suites (visible windows, pointer parked by the owner)

All passed on the first run.

| Check | Result | Notes |
| --- | --- | --- |
| `frames-granted` | 3/3 | [Results](frames-granted-results.json). New. One prompt for exactly `localhost` and `third.localhost`; only the links in those frames joined the capture, none twice. |
| `runs-granted` | 4/4 | [Results](runs-granted-results.json). New. One request for exactly two sites; three pages read in background tabs and closed, as one batch with one Undo. |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 10/10 | [Results](extended-browser-results.json). |
| `site-browser` | Pass | [Results](site-browser-results.json). |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). |
| `downloads-granted` | 6/6 | [Results](downloads-granted-results.json). The files landed in the test profile's own folder. |
| `access-granted` | 17/17 | [Results](access-granted-results.json). New, with all-sites access and no prompt: a PDF captured without a toolbar click; every frame of a page read once, with its frame's address; selected pages on two sites, one of them a PDF; PDF files on two sites into one ZIP and one combined PDF. |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

## Not automated

- **The lookup services themselves.** No test contacts them. Once, by hand, the built extension looked up three public identifiers (a DOI, an arXiv ID and a PubMed ID): three requests, one to each service, each answered, and the arXiv paper came back with its seven authors.
- **Real pages.** Auto-scroll, Follow Next, frames and closed components were checked on synthetic pages only. The owner's hands-on check covers real ones.
- **The right-click menus** can't be opened by automated Chrome.
- **Large PDFs.** The 50 MB and 200 MB limits were checked with made-up sizes; no PDF near them was read.
