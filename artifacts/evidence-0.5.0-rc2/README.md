# Evidence: 0.5.0 release candidate 2 (September 30 and October 1, 2026)

These results come from 0.5.0 "Research tools" release candidate 2 on `claude/0.5.0`. The product source tested is commit `5095b3e`. The commit after it, `9810b6f`, changed only a test helper.

Release candidate 2 follows the owner's hands-on check of release candidate 1, which found no failures and raised six observations. No ZIP was packaged. **Every check passed**, both without grants (on macOS, Windows and Linux) and after the owner's Allow clicks.

## What changed since release candidate 1

- **Move to… and Copy to…:** selected links, or one link from its details, go to another collection or a new one.
  - Everything travels: notes, tags, context, reading status, star, custom column values and the page citations the links use.
  - A column the destination lacks is created there. A link already there stays where it was.
  - One Undo puts both collections back.
- **The toolbar icon closes the side panel** on a second click in the same window. The full view in a tab stays open.
- **Backup and restore shows the last backup's date,** and says that removing Link Meteor from Chrome deletes what it saved.
- **Citations:**
  - A link uses the citation of a saved page about the same work: a page that names the link as its PDF, or one with the same DOI or arXiv ID. A link to an arXiv PDF then gets the abstract page's title, authors and date.
  - arXiv entries take their year and month from the ID when nothing else dates them, and every format marks them as arXiv preprints.
  - BibTeX titles brace acronyms and words with inner capitals.
  - RIS writes an ISBN as `SN`.
- **The Star toggle keeps its label,** so its state isn't announced twice.
- **PDFs and files on the computer** say what works (right-click a link) instead of asking for an ordinary webpage.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check` on `9810b6f`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 233 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: moving and copying with Undo, the citation a link uses, arXiv dates and preprints, braced BibTeX titles, RIS `SN`, the toolbar close, the last backup's time, and the messages on PDFs and local files. |
| `access-browser` | 35/35 | [Results](access-browser-results.json). New: a second press of Chrome's real toolbar action closes the side panel, with Chrome's own close and, with that replaced, by the panel itself; the full view stays open. |
| `move-browser` (new) | 6/6 | [Results](move-browser-results.json). The panel's preview, a move and a copy with Undo, a link's details, the borrowed citation, 320 px and contrast (lowest 6.02:1). |
| `backup-browser` | 23/23 | [Results](backup-browser-results.json). New: "Last backup: never", then the time of the backup just made; only the time is stored. |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). Every citation format downloaded equals the export code. |
| `access-content` | 50/50, simulation | [Results](access-content-results.json). |
| `reading-browser` | 12/12 | [Results](reading-browser-results.json). The Star toggle stays labeled "Star". |
| `imports-browser` | 12/12 | [Results](imports-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). |
| `site-check` | Pass | [Results](site-results.json). |
| The site/package sync | Skipped | No 0.5.0 ZIP yet. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks and all passed: workflow run 36767051595 on `5095b3e`, and run 36771564475 on `9810b6f`.

### Two things that happened on the way

- **A test's expectation, not the product:** the first full run failed `exports-browser` because the test allowed only two CSL-JSON types, and an arXiv preprint is now a third. The [log](diagnostics/exports-browser-first-run.txt) is kept.
- **One stalled run:** in the second full run, `access-browser` passed all of its checks up to the last section and then waited until the check's 20-minute limit, most likely on a reply Chrome never sent. The [log](diagnostics/access-browser-stalled-run.txt) is kept.
  - Fourteen runs of the suite alone, the full runs before and after it, and both GitHub runs passed.
  - Since `9810b6f`, a DevTools command that gets no reply fails after 90 seconds and names the command.

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
| `downloads-granted` | 6/6 | [Results](downloads-granted-results.json). The file landed in the test profile's own folder. |
| `access-granted` | 11/11 | [Results](access-granted-results.json). |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

These are automated Chrome for Testing checks. The owner's hands-on check of the new parts comes next, then release preparation, which includes the oldest supported Chrome.
