# Evidence: 0.5.0 release candidate 3 (October 1, 2026)

These results come from 0.5.0 "Research tools" release candidate 3 on `claude/0.5.0`. The product source tested is commit `91e851b`. The commits after it changed only the contracts and two tests.

Release candidate 3 follows the owner's hands-on check of release candidate 2. No ZIP was packaged at this stage. **Every check passed**, both without grants (on macOS, Windows and Linux, and on Chrome 116 where it can run) and after the owner's Allow clicks.

## What changed since release candidate 2

- **Add link on PDFs and local files.** Release candidate 2's message on PDFs told people to right-click a link and choose Add link, but its gate also stopped that menu item on PDFs. The menus now load the page script without the capture gate, and a page that can't be asked still gets the link saved with its address.
- **The full view replaces the side panel.** The side panel's button is labeled "Full view". When the full view opens, from that button or from the toolbar icon's menu, the side panel closes.
- **Papers with no authors yet.** For citation formats, the Export panel says how many entries have a DOI or arXiv ID but no authors, and how to fill them in: capture from the paper's own page, or save that page as a tab.

The owner's other finding, an arXiv export without authors, was a saved PDF tab with no saved page about the paper. Capturing "View PDF" from the abstract page gave every author, as designed.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check` on `657fbc8`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 234 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: Add link on PDFs and local files, the panel closing for the full view, and the count of papers without authors. |
| `access-browser` | 36/36 | [Results](access-browser-results.json). New: in the real side panel, the Full view button is labeled, opens the full view in a tab and closes the panel. |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). New: the line about papers with no authors yet. |
| `move-browser` | 6/6 | [Results](move-browser-results.json). |
| `backup-browser` | 23/23 | [Results](backup-browser-results.json). |
| `access-content` | 50/50, simulation | [Results](access-content-results.json). |
| `reading-browser` | 12/12 | [Results](reading-browser-results.json). |
| `imports-browser` | 12/12 | [Results](imports-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). |
| `site-check` | Pass | [Results](site-results.json). |
| The site/package sync | Skipped | No 0.5.0 ZIP at this stage. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `657fbc8` (workflow run 36895608399), and all passed.

**On Chrome 116**, the oldest supported Chrome, every suite that can run there passed. See [`chrome-116/`](chrome-116/README.md).

The first full run failed `exports-browser` on a number the test had hard-coded; the test now takes it from the citation code. The [log](diagnostics/exports-browser-first-run.txt) is kept.

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows, in two new profiles. Each request came from the product with an active user gesture. The grant logs are kept on the owner's computer.

- **Per-site profile, 5 prompts:** tabs, the fixture site, bookmarks, downloads, and a newly visited site through *Capture this page*.
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks.

## Granted suites (visible windows, pointer parked by the owner)

All passed on the first run.

| Check | Result | Notes |
| --- | --- | --- |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 10/10 | [Results](extended-browser-results.json). |
| `site-browser` | Pass | [Results](site-browser-results.json). |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). |
| `downloads-granted` | 6/6 | [Results](downloads-granted-results.json). The files landed in the test profile's own folder. |
| `access-granted` | 11/11 | [Results](access-granted-results.json). |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

## Not automated

- The right-click menus can't be opened by automated Chrome. Add link on a PDF is checked in simulation, and by probes that loaded the page script into a PDF on the web and a local PDF and showed its notice there.
- The owner's hands-on checks covered release candidates 1 and 2. Release candidate 3's changes are small and follow from the second check.
