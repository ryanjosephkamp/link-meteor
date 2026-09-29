# Evidence: 0.4.0 release candidate 2 (September 28, 2026)

These results come from 0.4.0 "Make it yours" release candidate 2 on `claude/0.4.0`. The product source tested is commit `b0ae18e`. The granted downloads suite's test fix came after it, in `0c0e678`, which changed no product file.

Release candidate 2 adds five things to release candidate 1 ([its evidence](../evidence-0.4.0-rc1/README.md)):
- saving tabs as links;
- custom columns;
- downloading the files behind links;
- highlights that follow their links while the page scrolls;
- more right-click items and a menu on the toolbar icon.

No ZIP was packaged. **Every check passed**, both without grants (on macOS, Windows and Linux) and after the owner's Allow clicks.

## What's new in release candidate 2

- **Save tabs as links:** besides capturing the links inside tabs, the workbench can save the tabs themselves: this tab, picked tabs, or every tab in the window. Each becomes one link with the tab's title and address. Pages that aren't web pages are skipped and counted.
- **Custom columns:** up to 20 per collection, named and filled in by hand, as plain text. They appear in each link's details, in search, in every export, and in backups. *Fill for selected links* sets one value on many links. A merge joins columns of the same name. Backups stay format 2.
- **Download the files behind links:** from the capture card (*Download N files*), the Export panel (*Download files*), a link's details (*Download*) and the right-click menu (*Download linked file*). This uses the optional `downloads` permission, which is asked for the first time, in the full view.
  - Files are saved to `Downloads/Link Meteor/<collection>/`, named after their anchor text.
  - Downloads run three at a time, and Link Meteor asks first above 10.
  - Cancel stops what hasn't finished.
  - A link that gives a web page instead of a file (often a sign-in page) is reported as such.
- **Highlights follow their links** while the page scrolls, and unticked links are outlined.
- **Menus:**
  - Right-clicking a link offers *Add link to "collection"*, *Copy link text + URL*, *Download linked file* (for file links) and *Select a region*.
  - A selection offers *Capture links in the selection*.
  - The page offers *Select a region*, *Capture this page* and *Save this tab as a link*.
  - The toolbar icon's menu offers *Save this tab as a link*, *Save all tabs in this window as links* and *Open the full view*.
- **Copy diagnostics** now says whether downloads access is on.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 162 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: custom columns (limits, values, removal and restore, merge by name, stored-value checks), file links and download names, and the menus (items, order, titles and every click, in simulation). |
| `access-browser` | 30/30 | [Results](access-browser-results.json). New: saving tabs as links through the real background (tabs Chrome hides are reported, not saved), *This page*, *Pick tabs* and *Save all tabs in this window* without tab access (simulated accept and decline). |
| `access-content` | 45/45, simulation | [Results](access-content-results.json). New: highlights stay on their links while the page scrolls, and an unticked link is only outlined. The card's *Download N files*, its progress, Cancel and the question above 10. The page notices after menu saves, *Copy link text + URL* and *Download linked file*. |
| `exports-browser` | 24/24 | [Results](exports-browser-results.json). New: custom columns in the collection editor, link details and *Fill for selected links*. Columns reach every export format, and formula-looking values stay text. Renaming, and removal with Undo. At 320 px and in both schemes, measured contrast is at least 4.5:1. |
| `backup-browser` | 22/22 | [Results](backup-browser-results.json). New: a backup keeps custom columns and values; the preview says how many columns a merge adds and how many can't fit; Undo reverses the merge. |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). *Download files*, *Download* in link details, files left waiting by the card or menu, and the question above 10, with Chrome's prompt stubbed. Nothing downloads. |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 14 checks, pass | [Results](visual-results.json). |
| `site-check` | Pass | [Results](site-results.json). |
| The site/package sync | Skipped | No 0.4.0 ZIP yet. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `b0ae18e` (workflow run 36473366348), and all passed. Earlier runs on the branch found only test-harness problems, now fixed:
- The downloads suite counted one extra tab listing from its simulated grant.
- Two suites asserted Playwright's download folder instead of "under `.scratch/`".
- On the slower macOS runner, the backup suite chose a file before a new profile had loaded its collections. It now waits for them.

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows. Each request came from the product with an active user gesture.

- **Per-site profile, 5 prompts:**
  - tabs;
  - the fixture site;
  - bookmarks;
  - **downloads** (new), from the Export panel's *Download files*, which then saved one fixture PDF into the profile's own folder under `.scratch/`;
  - a newly visited site through *Capture this page*.

  [Log](grants-site.log).
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks. [Log](grants-all.log).

## Granted suites (visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 9/9 | [Results](extended-browser-results.json). |
| `site-browser` | Pass | [Results](site-browser-results.json). All eight practice answer keys (7, 9, 10, 12, 7, 15, 3, 5), and 95 links for the whole page. |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10, not Microsoft Excel. 53 exact rows. |
| `downloads-granted` | 6/6, headless | [Results](downloads-granted-results.json). Chrome saved and named every file itself, with the owner's downloads grant. Checked: the PDF, the PNG and a `[PDF]` link; the sign-in page (reported as a web page); the missing file; both same-named PDFs kept; 11 files confirmed first and canceled with no partial files; and the card's *Download 6 files*. All 11 new files were in the profile's folder under `.scratch/`, and none in the Downloads folder of the person running it. |
| `access-granted` | 10/10 | [Results](access-granted-results.json). |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

**About `downloads-granted`.** Its first run [failed only on its last assertion](logs/downloads-granted-first-run.txt): every download and every file check had passed. That assertion expected no permission requests at all. By design, the workbench calls Chrome's request in every download click, before anything else, so the click still counts as the person's gesture; with access already granted, Chrome answers at once and shows nothing. The assertion now checks that each request asked only for downloads, which was already granted.

A second try in the same profile [added no links](logs/downloads-granted-second-try.txt), because the suite used fixed link IDs, which that profile already held. The IDs now carry the run's time.

The passing run used the profile's second granted site (port 52488), because `permission-browser` had already removed the first site's grant. The downloads grant was untouched.

These are automated Chrome for Testing checks. The owner's hands-on check in everyday Chrome comes next. It covers:
- saving tabs as links;
- custom columns in real spreadsheets;
- downloads of real PDFs, a paywalled link and a linked image;
- scrolling highlights;
- every menu.
