# Evidence: 0.4.0 release candidate 3 (September 29, 2026)

These results come from 0.4.0 "Make it yours" release candidate 3 on `claude/0.4.0`, source commit `02e6b3d`.

Release candidate 3 changes one file from [release candidate 2](../evidence-0.4.0-rc2/README.md), the build the owner checked by hand: `content/capture.js`. Chrome 116 reports a selection inside a shadow root as collapsed although its range isn't, so *Capture links in the selection* found nothing there ([how it was found](../evidence-0.4.0-rc2/chrome-116/README.md)). The page script now judges a selection by its ranges, for that menu item and for hold-key drag. `access-content` gains a check that makes Chrome report every selection as collapsed; it fails on the old code.

No ZIP was packaged at this stage. **Every check passed**, both without grants (on macOS, Windows and Linux, and on Chrome 116 where it can run) and after the owner's Allow clicks.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 162 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. |
| `access-browser` | 30/30 | [Results](access-browser-results.json). |
| `access-content` | 45/45, simulation | [Results](access-content-results.json). Includes the shadow-root selection that Chrome misreports as collapsed. |
| `exports-browser` | 24/24 | [Results](exports-browser-results.json). |
| `backup-browser` | 22/22 | [Results](backup-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 14 checks, pass | [Results](visual-results.json). Every theme in light and dark, and the toolbar icons in [`toolbar-icons.png`](toolbar-icons.png). |
| `site-check` | Pass | [Results](site-results.json). This ran while the 0.4.0 site pages were being edited; the [release evidence](../evidence-0.4.0-release/README.md) has the check of the finished site. |
| The site/package sync | Skipped | No 0.4.0 ZIP yet. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `02e6b3d` (workflow run 36584095139), and all passed.

**On Chrome 116**, every suite that can run there passed. See [`chrome-116/`](chrome-116/README.md).

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows, in two new profiles. Each request came from the product with an active user gesture.
- **Per-site profile, 5 prompts:** tabs, the fixture site, bookmarks, downloads (which then saved one fixture PDF under `.scratch/`), and a newly visited site through *Capture this page*. [Log](grants-site.log).
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks. [Log](grants-all.log).

## Granted suites (visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 9/9 | [Results](extended-browser-results.json). |
| `site-browser` | Pass | [Results](site-browser-results.json). All eight practice answer keys (7, 9, 10, 12, 7, 15, 3, 5), and 95 links for the whole page. |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10, not Microsoft Excel. 53 exact rows. |
| `downloads-granted` | 6/6, headless | [Results](downloads-granted-results.json). Chrome saved and named every file itself: the PDF, the PNG and a `[PDF]` link; the sign-in page, reported as a web page; the missing file; both same-named PDFs; 11 files confirmed first and canceled with no partial files; and the card's *Download 6 files*. All 11 new files were in the profile's folder under `.scratch/`, and none in the Downloads folder of the person running it. Each of the workbench's 3 permission requests found access already granted. |
| `access-granted` | 10/10 | [Results](access-granted-results.json). |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

These are automated Chrome for Testing checks. The owner's hands-on checks of release candidates 1 and 2 are recorded in [ACCEPTANCE.md](../../docs/ACCEPTANCE.md).
