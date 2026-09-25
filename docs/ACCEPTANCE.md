# Acceptance map

## 0.2.1 Astra audit candidate, September 25, 2026

**Status: repairs checked; final capture acceptance blocked. Do not treat this as approval to merge, deploy, or publish.** The original Opus section below remains historical evidence. The owner's unitemized everyday-Chrome report applies to 0.2.0, not this candidate. Full audit: [REPORT.md](audit-0.2.0/REPORT.md).

**Tested source:** `e8e69cf734ed750ee6b792cc3cae1f9bf898ce62` on `codex/audit-0.2.0`. Product files clean at packaging; later audit commits add artifacts, tests, site metadata and documentation. **Build:** `artifacts/link-meteor-0.2.1.zip`, 193,346 bytes, SHA-256 `231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9`. Actual ZIP members match current `src/`. Original ZIP, all 13 files in the owner's unpacked 0.2.0 folder, protected remote branches, annotated tag and draft PR #1 were independently rechecked unchanged.

Astra verified the original handback's model/export/XLSX identity, manifest-only version difference, read-only background addition and unchanged capture geometry/scanning against `a6dddac`. Repairs address removal of hidden selections, keyboard focus, stale batch controls, stale regional destination wording and overlapping regional saves. Schema v1, original link fields, export cores and permissions are unchanged. Site repairs enforce a main-only manual deployment job, compare actual packaged members with every source file, improve semantic export-preview headers and qualify test claims. No deployment or workflow dispatch occurred.

| Check executed by Astra | Result and limit |
| --- | --- |
| `npm test` | 26/26 pass, including 3 actual/stale/corrupt package checks. Simulated storage and permission races remain simulations. |
| `tests/audit-regressions.mjs` | 7/7 pass on loaded 0.2.1: focus, hidden selection, Select all 205, batch counts/labels/action, unchanged occurrence facts. Real extension, synthetic stored records. Original 0.2.0 defects reproduced separately. |
| `tests/audit-actions.mjs` | 9/9 pass: collections/notes/tags, UI and background cap, confirmation invalidation, exact opened local URL, Undo, grouping, note draft, denied/closed-tab failures, exact browser-restart persistence. No capture/bookmark grant assumed. |
| `tests/audit-overlay.mjs` | 4/4 pass: destination refresh, accurate save receipt, stable saved destination, one save for concurrent Add/Review. Actual packaged content code on an extension page with real messaging/storage; **not ordinary-page injection or native activation evidence**. Original 0.2.0 defects reproduced. |
| `tests/visual-browser.mjs` | 10 check groups pass, widths 320/390/412/900/1440; 22 sampled contrast pairs ≥5.1; zero unlabeled visible form controls, first focus ring and long-name checks. Steady-state screenshots; tab rendered at panel width, not native side-panel acceptance. |
| `python3 tests/verify-downloads.py` | Seven actual downloaded formats independently read; 205 exact XLSX/CSV/TSV/HTML/JSON pairs, Markdown single-line labels and exact URL list. One empty anchor and one formula-like label; XLSX cells are strings. openpyxl 3.1.5, not Microsoft Excel. |
| XLSX fixture + `verify-workbook.py` | ZIP/OOXML and openpyxl exact values pass for the existing edge-case workbook. |
| `tests/site-check.mjs` | 50 page/width/theme cases pass; internal links, anchors, names, contrast, 404, keyboard menu, demo and export checks. Site workbook independently matches all 6 source anchors/URLs, including the empty anchor. No external page requests observed. |
| `node scripts/sync-site.mjs --check` | Pass; exact source/member check and site ZIP/hash/module checks. |
| `tests/prepare-grants.mjs` | **Blocked**: optional tabs request remains pending with active user gesture, no API error and no optional grants. Confirmed in fresh 0.2.0 and 0.2.1 task profiles. Native automation bound another test-browser window; no native Allow/Deny click was made. |
| `tests/browser.mjs`, `extended-browser.mjs`, `site-browser.mjs`, `permission-browser.mjs` | **Not run in this audit: grant preparation precondition unmet.** Opus's historical successes below are not substituted for Astra acceptance. Permission suite must remain last when resumed. |

Evidence is under `artifacts/audit-0.2.0/` (the audit is named for the reviewed handback). The latest successful visual receipt uses a fresh profile; `visual-reused-profile-diagnostic.json` preserves a failed screenshot retry whose reused fixture profile already contained the same globally unique occurrence IDs. No product repair was needed for that harness setup error. Design/overlay preview mocks were not used for acceptance.

Remaining: ordinary-page regional geometry and scopes, practice-page answer keys, large capture, actual bookmarks, hold/revocation and clipboard reruns after grants; native Allow/Deny and side-panel interaction; everyday Chrome 0.2.1, Microsoft Excel, screen readers, real sites, Windows/Linux, Chrome 116, real phones and deployed Pages. No compatibility or performance claim beyond the recorded checks.

---

## 0.2.0 design pass (Claude Opus 5.5), September 25, 2026

Status: redesigned extension and new website, functionally re-checked on the actual packaged build. Ready for the user's review and GPT-6 Astra's final functionality audit. Not a store release, not deployed, not human acceptance.

**Build under test:** `artifacts/link-meteor-0.2.0.zip`, 191,513 bytes, SHA-256 `1cb1b778a91180709455e273eb9b0f1cbefe758a6e43d01156729c14330fc197`, 13 files, packaged from commit `7c9ca4a` with `sourceFilesGitDirty: false` (per-file hashes in `artifacts/link-meteor-0.2.0.sha256.json`). Compared with baseline `a6dddac`: `core/model.js`, `core/export.js` and `core/xlsx.js` are byte-identical; the manifest changed only its version, with identical permissions; `background.js` adds the read-only `collection.active` message; `content/capture.js` changes overlay markup/styles and adds the destination and preview lines; the workbench UI and icons are rebuilt.

**Profiles:** fresh task-owned `.scratch/design-accept-2` (functional suites, same build fingerprint throughout) and `.scratch/design-visual-2` (visual suite). Optional grants (tabs, `http://127.0.0.1:52478/*`, bookmarks) were established by `tests/prepare-grants.mjs` through the product's own UI permission requests in headed, Playwright-launched Chrome for Testing. Each request resolved as granted within seconds without any click from the driver; whether Chrome auto-accepted under automation or a person clicked was not established. Treat these grants as automation-established, **not** native Allow/Deny acceptance. The permission-request code and its call order in click handlers are unchanged from the baseline.

| Suite (actual 0.2.0 build) | Result | Notes |
| --- | --- | --- |
| `npm test` | 23/23 pass | The UI race harness now also supplies `renderCaptureButton`, `originAccess` and the real `count`/`plural` helpers extracted from the product file. |
| `tests/browser.mjs`, headed | 27/27 pass | Same checks as the baseline. Path changes only: open the collection editor before notes, open View before grouping, and wait up to 2 s for the live badge to reach exactly 5 (pointer moves are frame-aligned; the count saved at release is asserted exactly as before). |
| `tests/extended-browser.mjs`, headed | 8/8 pass | The opener is now an inline confirmation: asserts the exact count text and that no tab opens before confirming. Selection wording is `100 selected · 0 on this page`. |
| `tests/site-browser.mjs`, headed | pass | New. Real overlay drags on the site's practice page match every published answer key: reading 7, results 9, tickets 10, products 12, tricky 7, scrolling archive 15, same-origin frame 3, shadow root + late-loaded 5. Field checks: formula/markup labels kept as text, icon-only link has empty anchor text and a separate ARIA label, hidden text and hidden/script links excluded, frame and shadow provenance present. Whole-page capture found 85 links. Mixed five-tab report: success ×3, denied, unsupported. |
| `tests/permission-browser.mjs`, headed, run last | 3/3 pass | Real revocation prunes the hold origin and registration, stops the loaded gesture, and makes the next capture a denied result. |
| `tests/visual-browser.mjs`, headless | pass | No horizontal overflow at 320/390/412/900/1440 and in compact collections/export views; zero unlabeled visible controls; focus ring on first Tab; 22 measured text pairs ≥ 4.5:1 in light and dark (lowest 5.1); a 120-character collection name fits at 320/390/1440. |
| `python3 tests/verify-downloads.py` | pass | New reproducible reader: openpyxl reads the actual downloaded XLSX; all 59 anchor/URL pairs equal JSON and CSV (after the formula apostrophe); every cell is a string; 2 empty anchors, 3 formula-like labels. |
| `tests/xlsx-fixture.mjs` + `verify-workbook.py` | pass | Unchanged export core. |
| `tests/site-check.mjs` | pass | New. 5 pages × 5 widths × light/dark served under `/link-meteor/`: no overflow, console errors, failed or off-site requests; one h1, landmarks, skip link, alt text, named controls and no skipped heading levels; all internal links and anchors resolve; lowest measured text contrast 4.63:1; 404 page at a nested path; keyboard mobile menu; demo drag/select-all; export preview CSV/Markdown/XLSX from the real export module. |
| `node scripts/sync-site.mjs --check` | pass | The site's ZIP, SHA-256, export modules, icons and shared header/footer match the build. |

Screenshots of real states are in `artifacts/evidence/`: `workbench-desktop.png`, `workbench-review.png` (grouped with details), `workbench-dark.png`, `workbench-narrow.png`, `panel-dark.png`, `panel-export.png`, `panel-collections.png`, `panel-empty.png`, `region-drag.png`, `permission-denied.png`, `site-overlay-drag.png`, `site-overlay-card.png`, `site-workbench.png`, `site-panel.png`, `site-panel-dark.png`, `site-report.png`, and the site's own `site-home*.png`, `site-install.png`, `site-practice-page.png`. Panel-width images render the workbench page in a tab at side-panel width; Chrome's native side-panel frame is not captured.

**User report (September 25, 2026):** the user loaded the 0.2.0 build unpacked in their everyday Google Chrome, tried it, and reported that it all works. The specific steps covered were not itemized. After the automated runs above, two practice-page spellings were changed to American English: a ticket summary cell ("license") and one shadow-root link label ("Neighborhood heat map"). Link counts and URLs are unchanged, and `tests/site-check.mjs` and `sync-site.mjs --check` were re-run afterward.

**Still unverified (human acceptance):** everyday Google Chrome; the native permission Allow/Deny sheets; the native side panel's real width and resizing; Windows/Linux shortcuts; Microsoft Excel itself; screen readers; real research and admin sites; Chrome 116; the deployed site on GitHub Pages; the site on real phones and non-Chromium browsers.

---

## Iteration 01 baseline (historical)

The map below describes baseline `a6dddac` (0.1.0). It remains useful context; the 0.2.0 results above supersede it for the current build.

### Iteration 01 acceptance map

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
