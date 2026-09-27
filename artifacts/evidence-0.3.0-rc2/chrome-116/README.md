# Evidence: 0.3.0 on Chrome 116 (September 27, 2026)

Link Meteor 0.3.0 declares Chrome 116 as its oldest supported version (`minimum_chrome_version` in the manifest). These results come from the checks that need no optional grants, run on **Chrome for Testing 116.0.5845.96** for macOS ([version record](chrome-version.txt)). The extension tested is the release candidate 2 source, commit `bd3f6b5`, unchanged in `5d43d48`.

**Result: no product failure on Chrome 116. The minimum stays at 116.** Chrome 116 loads the extension and starts its background worker, and every suite that can run there passes. Two suites can't run on 116, because they drive Chrome's toolbar button through DevTools commands that 116 doesn't have. The checks that need the owner's Allow clicks were not run on 116.

## How the checks were run

`LINK_METEOR_CHROME_PATH` points the test helpers at the Chrome 116 app instead of the Chrome for Testing build used for release candidate 2 (151.0.7922.34).

Before Chrome 132, the bare `--headless` flag that Playwright passes starts the old headless mode, which runs no extensions. So when that variable is set, the helpers add `--headless=new`. Each suite used a fresh task-owned profile.

## Results

| Check | Result on 116 | Notes |
| --- | --- | --- |
| `tests/access-content.mjs` | 22/22, simulation | [Results](access-content-results.json). The first run launched the old headless mode, because this suite starts Chrome itself and the flag wasn't yet shared with it. It passed 9 checks, then a card shortcut didn't reach the card. The rerun in the new headless mode passed every check. [First run](access-content-run1-old-headless/). |
| `tests/exports-browser.mjs` | 13/13 | [Results](exports-browser-results.json). Its downloads are in [`exports/`](exports/). |
| `tests/backup-browser.mjs` | 19/19 | [Results](backup-browser-results.json). This includes the synthetic 20,000-link restore. The 12 MB backup file is regenerated on each run and isn't kept. |
| `tests/audit-overlay.mjs`, `audit-actions.mjs`, `audit-regressions.mjs` | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `tests/visual-browser.mjs` | 13 checks, pass on the second run | [Results](visual-results.json). The first run failed one reading: the strong opening confirmation measured 1.04:1 in the light theme, taken 250 ms after the test switched from dark. Chrome 116 computed the same colors as 151, and the confirmation reads clearly in both themes. A fresh-profile rerun passed every check, so this was a timing flake in the measurement. [First run](visual-run1/). |
| `tests/access-browser.mjs` | 5 of 20, then stopped | [Results](access-browser-results.json), [log](logs/access-browser.txt). The welcome card, its keyboard order, the declined request, Close, and the Site access settings pass. Check 6 is the first to press Chrome's toolbar button with `Extensions.triggerAction`, and Chrome 116 answers that the command wasn't found. The remaining checks depend on that button, or on `Extensions.loadUnpacked` for the restart check. |
| `tests/capture-page-access.mjs` | Can't run on 116 | [Results](capture-page-access.json). Every step starts with a toolbar press through `Extensions.triggerAction`. |

The `Extensions` DevTools commands arrived in later Chrome releases, so these two suites test 0.3.0's toolbar behavior only on the newer Chrome for Testing build. [Release candidate 2](../README.md) covers them there.

## Static check

Every extension API and web platform feature the 0.3.0 source uses was available by Chrome 116. The newest is `chrome.sidePanel.open`, which arrived in 116 itself.

| Feature | Available since |
| --- | --- |
| `chrome.storage.session` | Chrome 102 |
| `chrome.scripting.registerContentScripts` with `persistAcrossSessions` | Chrome 96 |
| `chrome.tabGroups` | Chrome 89 |
| CSS `:has()` and container queries | Chrome 105 |
| `oklch()` and `color-mix()` | Chrome 111 |
| `text-wrap: balance` | Chrome 114 |

## Not covered on 116

- The suites that need the owner's Allow clicks: `browser`, `extended-browser`, `site-browser`, `audit-granted-regressions`, `access-granted` and `permission-browser`.
- Toolbar-button behavior (see above).
- Everyday Chrome 116 by hand, and Chrome 116 on Windows or Linux.

These are automated Chrome for Testing checks on macOS.
