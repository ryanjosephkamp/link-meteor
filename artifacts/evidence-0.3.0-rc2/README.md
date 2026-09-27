# Evidence: 0.3.0 release candidate 2 (September 27, 2026)

These results come from 0.3.0 release candidate 2 on `codex/0.3.0-rc2`. The extension source tested is commit `bd3f6b5`: release candidate 1 plus the fixes for the three issues its granted run found. No ZIP was packaged. **Every check passed**, both without grants and after the owner's Allow clicks.

## What changed since release candidate 1

- **Hold-drag on pages opened while Link Meteor starts.** Release candidate 1 found a page opened right after launch with no Link Meteor script at all. Now:
  - the page script replaces an earlier copy that has lost its connection to the extension;
  - when Link Meteor is installed, updated or started, it loads the script into open tabs where hold-drag runs;
  - whenever it syncs hold settings, it loads the script into any tab where hold-drag should run but no script answers.
- **The "Remove Chrome's access" wording.** It now says removing all-sites access can also remove access to sites allowed one by one, which is what Chrome did.
- **The all-sites switch** keeps showing the person's choice while that choice is being saved.
- **Test changes:**
  - the per-site part of `permission-browser` first shows that hold-drag works;
  - the all-sites part again opens its pages before the workbench;
  - the restart check uses DevTools `Extensions.loadUnpacked`, because `chrome.runtime.reload()` unloads a command-line extension for good in Chrome for Testing.

## Checks without optional grants (headless, fresh task-owned profiles)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | 94 tests: 93 pass, 1 skipped | [Output](node-tests.txt). The skip is the current-ZIP check. |
| `tests/access-browser.mjs` | 20/20 | [Results](access-browser-results.json). New: after Link Meteor is reinstalled in place with a page open, region selection works and the page's script answers messages, without the page reloading. An emptied `chrome.storage.session` proves the restart happened. |
| `tests/access-content.mjs` | 22/22, simulation | [Results](access-content-results.json). |
| `tests/exports-browser.mjs` | 13/13 | [Results](exports-browser-results.json). Its downloads are in [`exports/exports-browser/`](exports/exports-browser/). |
| `tests/backup-browser.mjs` | 19/19 | [Results](backup-browser-results.json). The 12 MB synthetic 20,000-link backup is regenerated on each run and not kept. |
| `tests/capture-page-access.mjs` | Pass | [Results](capture-page-access.json). |
| `tests/audit-overlay.mjs`, `audit-actions.mjs`, `audit-regressions.mjs` | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `tests/visual-browser.mjs` | Pass, 13 checks | [Results](visual-results.json). |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). The site is unchanged and still offers 0.2.2. |

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows, and each request came from the product itself with an active user gesture.

- **Per-site profile, 4 prompts.** Capture this page asked for a newly visited site in the same click, then captured 37 links. [Log](grants-site-profile.log).
- **All-sites profile, 5 prompts.** [Log](grants-all-sites-profile.log).

## Granted suites (visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `tests/browser.mjs` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `tests/extended-browser.mjs` | 9/9 | [Results](extended-browser-results.json). This includes saving into an existing bookmark folder with Chrome's real bookmark API. |
| `tests/site-browser.mjs` | Pass | [Results](site-browser-results.json). All eight practice answer keys, and 95 links for the whole page. |
| `tests/audit-granted-regressions.mjs` | 4/4 | [Results](granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10, not Microsoft Excel. |
| `tests/access-granted.mjs` | 10/10 | [Results](access-granted-results.json). New: a page opened as the browser starts gets hold-drag on the first try, about a second after it loads. The all-sites switch passes Playwright's strict `check()`, so it stays on while saving. |
| `tests/permission-browser.mjs` | 10/10, run last | [Results](permission-browser-results.json). The per-site gesture works before revocation and stops after it. With pages opened as the browser starts, removing all-sites access returns the scope to `'sites'`, and saved hold sites and registrations match what Chrome still grants. The open page stops without a reload, capture there is denied, and the switch shows off. |

## Diagnostics

[`diagnostics/first-attempt/`](diagnostics/first-attempt/) and the two `access-browser-run*` folders hold an earlier attempt on this branch. It stopped at a restart check that used `chrome.runtime.reload()`, which cannot work in this setup; that check was replaced.

While diagnosing, a copied test profile was also launched with a newer build of the same version. Chrome kept running that profile's cached background script. That is why every suite uses a fresh profile per build, and the copied-profile runs are not evidence.

These are automated Chrome for Testing checks on macOS. They do not replace the owner's hands-on check in everyday Chrome, Microsoft Excel, Chrome's own site-access menu, a native Deny, Windows and Linux, or other browsers.
