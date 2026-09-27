# Evidence: 0.3.0 integration build, release candidate 1 (September 27, 2026)

These results come from the first integrated 0.3.0 build on `claude/0.3.0`: the three merged areas of work plus the lead's changes. The extension source tested is commit `7da87b9`; later commits change only tests and docs. No ZIP was packaged. **This build is not ready for release:** the granted run found three product issues, listed below, that the next build fixes.

## Checks without optional grants (headless, fresh task-owned profiles)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | 94 tests: 93 pass, 1 skipped | [Output](node-tests.txt). The skip is the current-ZIP check; no 0.3.0 ZIP is packaged. |
| `tests/access-browser.mjs` | 19/19 | [Results](access-browser-results.json). The welcome card, Site access, opening tiers, the capture card through Chrome's real toolbar action, and the new "Allow on all sites" offer when Chrome hides a page, with Chrome's prompt stubbed to decline. |
| `tests/access-content.mjs` | 22/22, simulation | [Results](access-content-results.json). The page script in ordinary pages, with real input and a stubbed `chrome` object. |
| `tests/exports-browser.mjs` | 13/13 | [Results](exports-browser-results.json). File names, name settings, the formatted workbook read by openpyxl, and CSV and TSV byte-for-byte against 0.2.2. The downloads are in [`exports/exports-browser/`](exports/exports-browser/). |
| `tests/backup-browser.mjs` | 19/19 | [Results](backup-browser-results.json). Backup, preview, merge, replace, Undo, invalid files, Select all, Remove all in this view, Empty this collection, and one synthetic 20,000-link restore. The 12 MB synthetic backup file is regenerated on each run and is not kept here. |
| `tests/capture-page-access.mjs` | Pass | [Results](capture-page-access.json). |
| `tests/audit-overlay.mjs`, `audit-actions.mjs`, `audit-regressions.mjs` | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `tests/visual-browser.mjs` | Pass, 13 checks | [Results](visual-results.json). New: the welcome card, screenshotted once ([`panel-welcome.png`](panel-welcome.png)), measured in both themes and then answered. Also contrast for Site access help, an exception, the stronger confirmation from a real 150-link target (nothing opened), and the all-sites note and opening progress line shown with sample text. The lowest measured ratio is 5.1:1. |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). The site is unchanged and still offers 0.2.2. |

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows. Each request was made by the product itself with an active user gesture.

- **Per-site profile, 4 prompts:** tabs, the fixture site, bookmarks, and a newly visited second site. Capture this page asked for that site in the same click, then captured 37 links. [Log](grants-site-profile.log).
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups, and bookmarks. [Log](grants-all-sites-profile.log). The first attempt stopped at tab groups, because the setup script pressed Open as a tab group while the previous 37-link collection was still showing. More than 20 links asks first, so Chrome's prompt never appeared. After a script fix, a fresh profile was used. [Diagnostic](diagnostics/grants-all-sites-run1-tabgroups-timeout/).

## Granted suites (visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `tests/browser.mjs` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `tests/extended-browser.mjs` | 9/9 | [Results](extended-browser-results.json). This includes the new existing-folder check against Chrome's real bookmark API. Two earlier runs failed on the test's own expectations, both now fixed. Chrome for Testing names the folder "Other Bookmarks", and the expected list double-counted one link. [Run 1](diagnostics/extended-run1-folder-path/), [run 2](diagnostics/extended-run2-expected-list/). |
| `tests/site-browser.mjs` | Pass | [Results](site-browser-results.json). All eight practice answer keys, and 95 links for the whole page. |
| `tests/audit-granted-regressions.mjs` | 4/4 | [Results](granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10 read the formatted workbook: 52 clickable links whose targets equal the cell text. This is a library reader, not Microsoft Excel. |
| `tests/access-granted.mjs` | 9/9 | [Results](access-granted-results.json). All-sites registration; hold-drag on a second site with no prompt; Command-drag on a real page while a plain Command-click still opens the link; exceptions without a reload; the This site toggle; capture on a never-visited site with no prompt; named tab groups from the workbench and the capture card; the card's bookmark folder; and the switch off and on. Two earlier runs are kept: a test race that is now fixed, and the switch flicker below. [Run 1](diagnostics/access-granted-run1-named-group/), [run 2](diagnostics/access-granted-run2-switch-flicker/). |
| `tests/permission-browser.mjs`, per-site part | 3/3 | [Run 1 results](diagnostics/permission-run1-startup-page/). The saved hold origin and registration are pruned, the loaded page stops, and capture is denied. **Limit:** this part never checks that hold-drag worked before the revocation, so its "stops" check may have passed without the gesture ever running. See issue 1. |
| `tests/permission-browser.mjs`, all-sites part | Stopped at its third check | [Results](permission-browser-results.json). Run 1 failed its precondition because of issue 1. Rerun with the workbench loaded first, the precondition passed: hold-drag ran on a second site. Removing all-sites access returned the saved scope to `'sites'`. The next check expected Chrome to keep the per-site grant, and Chrome removed it too. See issue 2. A later read of the profile shows the product followed Chrome correctly: no site access, scope `'sites'`, no saved hold sites, no script registrations, switch off. |

## Product issues found (fixed in the next build, not in this one)

1. **A page script can stay disconnected after the extension restarts.** Chrome for Testing restarts the unpacked extension shortly after launch. A page loaded just before that keeps a script that can no longer reach the extension: messages fail with "Receiving end does not exist", and hold-drag and region selection do nothing there. Link Meteor's load-once guard, unchanged since 0.2.2, then stops a fresh copy from loading until the page reloads. In everyday use, the same thing would follow any extension restart with tabs open, such as an update or a reload. [Diagnostic](diagnostics/permission-run1-startup-page/).
2. **The "Remove Chrome's access" confirmation promised too much.** It says sites allowed one by one keep their access, but removing `http://*/*` and `https://*/*` also removed the narrower site grant they cover. The docs are corrected; the confirmation text changes in the next build.
3. **The all-sites switch can flip back briefly while its choice is being saved.** A render in that moment, such as the reload after another saved change, showed the saved state. The switch ends correct once the save finishes. A fix is ready for the next build.

These are automated Chrome for Testing checks on macOS. They do not replace the owner's hands-on check in everyday Chrome, Microsoft Excel, Chrome's own site-access menu, a native Deny, Windows and Linux, or other browsers.
