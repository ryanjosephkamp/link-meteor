# Iteration 01 acceptance map

Status: functionally checked Chrome baseline for user review and the planned Opus design pass. Not a store release, not human acceptance, and not a claim of universal browser/site compatibility.

## Evidence by requirement

| Requirement | Executed evidence | Limits |
| --- | --- | --- |
| Anchor text separate from URL | Actual 37-occurrence fixture; hidden label excluded; image anchor empty; alt/ARIA separate; same URL/different labels retained. Downloaded XLSX independently matched 53 exact anchor/URL pairs. | Whitespace is normalized; surrounding text/citation enrichment is outside scope. |
| Region selection | Loaded extension real pointer drag captures exactly five bibliography links, live count/highlights, Escape, no navigation, append without double-save, 1px wrapped-line intersection. Page and nested scrolling plus same-origin frame region checked. | Cross-origin/closed frames and arbitrary transformed/occluded layouts are not promised. |
| Activation | Native Option+Shift+L, Escape, toolbar side panel and page context menu observed through CUA in Chrome for Testing. Configured hold key works and ignores editable typing. | Everyday installed Google Chrome, Windows/Linux native shortcuts and shortcut-conflict behavior remain manual checks. |
| Capture scopes | Actual UI current page, selected tabs, current window, all ordinary windows with two real test windows. | Only current Chrome profile. No incognito, crawling or pasted-URL capture. |
| Partial failure | Actual batch success + genuine empty + missing grant + chrome:// page + closed-tab ID. Successful links retained; persisted report survives another UI load. | Permission-race tests use explicitly simulated UI/Chrome dependencies. Native Deny button not established. |
| Collections and persistence | UI creation/notes/tags, per-link notes, drafts surviving concurrent state update; exact state equality after full browser/worker restart. Reducer lifecycle tests. | Storage-quota failure is an API simulation, not a filled real Chrome profile. No restore/import flow. |
| Review/undo | UI filters, sort, selection, reversible grouping, source details, positional removal/undo. | Human research-workflow comfort and screen-reader use remain review items. |
| Exports | Seven actual downloads: CSV, TSV, XLSX, Markdown, HTML, JSON, URL list. Ordered columns, escaped hostile labels, formula safety, empty labels, grouped provenance tested. Clipboard verified by pasting generated TSV. | Independent openpyxl/OOXML reading, not Microsoft Excel/LibreOffice application acceptance. Regional copy has success-feedback evidence; actual paste test is from the workbench. |
| Bookmarks/open | Native bookmark permission Allow; actual folder/title/URL contents; actual confirmed local tab opened; >20 rejected before tab creation; non-web skip count shown. | Browser bookmark sync is controlled by Chrome settings; other destination sites not visited in tests. |
| Large collection | 5,037 actual loaded DOM links; only 100 rows rendered; complete export; page selection; lazy grouped details in increments of 100. | One final synthetic capture observation was 577 ms. No general performance guarantee, RAM benchmark or stress-to-failure claim. |
| Permissions/hold revocation | Actual removal of granted test origin: persisted origin pruned, dynamic registration removed, loaded gesture disabled, later capture denied. | Native Deny button remains unverified; test browser auto-granted re-request attempts. No everyday profile was touched. |
| Accessibility/presentation | Semantic labeled controls, keyboard focus, visible focus rules, reduced motion, light/dark screenshots; 320/390/412/1440px bounds; long-name case; destructive dark-text contrast spot check. | Not a complete WCAG or assistive-technology audit. Final small CSS contrast change was checked separately with unchanged functional JS. |
| Local/free behavior | Source review: no network calls/backend, no telemetry/accounts/ads/payment; packaged assets and zero runtime dependencies. | Store disclosure forms, legal/name clearance and publication approval are later steps. |

## Evidence files

- `artifacts/evidence/browser-results.json`: 27 loaded-extension checks, test timestamps and grants.
- `artifacts/evidence/extended-browser-results.json`: 8 large-collection/action checks.
- `artifacts/evidence/permission-browser-results.json`: 3 real revocation checks with native-denial limit.
- `artifacts/evidence/visual-results.json`: responsive, labels, focus and measured contrast checks.
- `artifacts/evidence/workbook-results.json`: independent reader of actual download bytes.
- `artifacts/evidence/exports/`: actual synthetic exported files.
- `artifacts/evidence/region-drag.png`, `workbench-desktop.png`, `workbench-review.png`, `workbench-narrow.png`, `workbench-dark.png`, `permission-denied.png`: implemented surfaces, not mockups.
- `docs/worker-*.md`: worker implementation/static-review evidence; driver independently integrated and checked the resulting code.

Early failed browser results drove repairs or corrected test assumptions. The current JSON files describe their latest completed runs. Stale-worker behavior in reused unpacked profiles was resolved for acceptance by new profiles and build fingerprints. Runtime reload experiments did not establish a reliable reload path; do not use them as evidence.

## Reproduce

Use Node 22+, `npm run build`, `npm test`, and `npm run package`. No npm install is required. See README for installed Playwright discovery and isolated-profile preparation. Real optional permissions must be prepared in that test profile. Profiles and screenshots contain synthetic fixture data only.

`node tests/browser.mjs`, `node tests/extended-browser.mjs`, and `node tests/visual-browser.mjs` are separate suites. `node tests/permission-browser.mjs` revokes a previously granted synthetic origin; run it last and prepare grants again before later functional runs. Set `LINK_METEOR_PERMISSION_ORIGIN` when testing another granted local origin. Permission changes never target a personal profile.

`node tests/xlsx-fixture.mjs` writes a workbook and expected JSON under `.scratch`. Run `python3 tests/verify-workbook.py .scratch/workbook-fixture.xlsx .scratch/workbook-fixture.expected.json` with an environment containing openpyxl for the independent library check; without it the script reports structural-only coverage. This iteration used the already installed bundled Python runtime.

Node tests cover pure model/export behavior and deliberately simulated adverse Chrome paths: storage failure preserves old state, failed session bookkeeping cannot contradict capture success, hold configuration serializes, revocation reconciles settings, failed Review opening reports a successful save with a warning, and an unreadable schema is preserved. UI race tests retain closed selected IDs, exclude newly opened tabs and reject navigated survivors.

The test approach follows [Playwright's extension-testing guidance](https://playwright.dev/docs/chrome-extensions). Host access follows [Chrome's match-pattern model](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns). These references explain the test/permission approach; the local results above are the acceptance evidence.

## Human review still needed

Load the unpacked build in ordinary Chrome, test on two or three real research/admin pages you use, try the shortcut and hold preference, inspect a spreadsheet in Excel, and judge interaction/aesthetic quality. Try the permission Deny button and a screen reader if relevant. Neither the store nor Firefox/Safari have been tested. The Opus pass should preserve the contract, then return for Astra's final functionality audit.
