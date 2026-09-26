# Testing and compatibility

The current development build is **0.2.1**. Its automated checks passed in the tested configuration on September 25, 2026. This is evidence for those workflows and environments, not universal browser/site compatibility or a complete accessibility certification.

## Tested build

- Package: [`artifacts/link-meteor-0.2.1.zip`](../artifacts/link-meteor-0.2.1.zip), 193346 bytes.
- SHA-256: `231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9`.
- Product source: `e8e69cf734ed750ee6b792cc3cae1f9bf898ce62`.
- [Per-file receipt](../artifacts/link-meteor-0.2.1.sha256.json): all 13 package members match the extension source. Later documentation changes do not change the packaged product.

Tests used isolated Chrome for Testing profiles on macOS with synthetic webpages and collection data. Functional suites exercised the loaded extension, not a reconstruction of its UI. Scripted API failures and presentation previews are identified separately below.

## Current functional evidence

| Check | Result | What it establishes and its limits |
| --- | --- | --- |
| `npm test` | 26 passing tests | Model/export behavior, storage failure handling, permission and selection races. Adverse API paths are simulations, not a full Chrome storage quota or native prompt test. [Output](../artifacts/audit-0.2.0/node-tests-repair.txt). |
| `tests/browser.mjs` | 27/27 | Actual regional geometry, wrapped links, scrolling/frames, all capture scopes, mixed failures, clipboard paste, collections, filtering, Undo, exports and exact restart persistence. [Results](../artifacts/audit-0.2.0/resume-01/browser-results.json). |
| `tests/extended-browser.mjs` | 8/8 | A page with 5037 loaded links, bounded rendering, complete export, actual bookmark contents, inline opening confirmation and the 20-link cap, grouping and draft preservation. [Results](../artifacts/audit-0.2.0/resume-01/extended-browser-results.json). No general performance guarantee follows from one synthetic run. |
| `tests/site-browser.mjs` | Pass | All eight practice answer keys: 7, 9, 10, 12, 7, 15, 3 and 5; 85 for the whole page. Empty anchors, separate accessible labels, formula/markup strings, frame/shadow provenance and mixed capture outcomes. [Results](../artifacts/audit-0.2.0/resume-01/site-browser-results.json). |
| `tests/audit-granted-regressions.mjs` | 4/4 | Keyboard tab-checkbox focus, changed collection destination, overlapping Add/Review commits and stable saved feedback. Concurrent clicks were deliberately dispatched in one event-loop turn using the loaded extension. [Results](../artifacts/audit-0.2.0/resume-01/granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | Seven downloaded formats read independently: 53 exact anchor/URL pairs in XLSX/CSV/TSV/HTML/JSON, expected Markdown normalization and exact URL list. Included two empty anchors and one formula-like label. openpyxl 3.1.5 read the XLSX, not Microsoft Excel. [Reader evidence](../artifacts/audit-0.2.0/resume-01/workbook-results.json). |
| `tests/permission-browser.mjs` | 3/3 | Real fixture-origin revocation removes hold settings/registration, disables the loaded gesture and returns denied on capture. [Results](../artifacts/audit-0.2.0/resume-01/permission-browser-results.json). The native Deny button was not tested. |

Optional tabs, local-origin and bookmark permissions were established through actual product requests with an active user gesture in the automated browser. The mechanism of native approval was not established. Successful grants must not be represented as an observed native Allow/Deny interaction. The revocation suite ran last.

## Presentation and website checks

The 0.2.1 [visual results](../artifacts/audit-0.2.0/repair-ui/visual-results.json) cover responsive widths, long names, labeled controls, keyboard focus and sampled contrast. They are not a complete screen-reader or WCAG audit. Panel-width screenshots render the workbench at a compact width; they do not prove native side-panel framing or resizing.

The [site results](../artifacts/audit-0.2.0/repair-ui/site-results.json) check five pages across five widths and light/dark themes, internal links, semantic structure, sampled contrast, keyboard menu use, interactive demo, nested 404 handling and export preview contents. These are automated Chromium checks. The site is available at [Link Meteor](https://ryanjosephkamp.github.io/link-meteor/); real-device and non-Chromium testing remain separate.

`node scripts/sync-site.mjs --check` verifies the site's package, hashes, icons, export modules, shared header/footer and version metadata against current source. `tests/design-preview.mjs` and `tests/overlay-preview.mjs` use simulated extension APIs for presentation work; their images are not functional acceptance evidence.

The earlier 0.2.0 package has separate [historical test results](../artifacts/evidence/browser-results.json). Those results should not be substituted for the current build's evidence. Diagnostic failures remain available alongside successful runs, rather than being described as passing checks.

## Reproduce

See the [README](../README.md#develop-and-verify) for Node, installed Playwright discovery, fixture server settings and isolated profile setup. The browser suite resets collections in the selected test profile: never use a personal profile. Prepare actual optional permissions with `tests/prepare-grants.mjs` before functional suites, and run `tests/permission-browser.mjs` last because it revokes the fixture-origin grant.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` also check OOXML and independent workbook parsing. Without openpyxl, the reader reports structural-only coverage. Actual downloaded files are under [`artifacts/audit-0.2.0/resume-01/exports/`](../artifacts/audit-0.2.0/resume-01/exports/).

## Remaining compatibility and human checks

- Everyday Google Chrome 0.2.1 and real research/admin sites.
- Native Allow/Deny interactions and native side-panel width/resizing.
- Microsoft Excel and other spreadsheet applications, beyond file-reader checks.
- Screen readers and other assistive technologies.
- Windows/Linux, native shortcuts on those systems and Chrome 116. The manifest's minimum version is a declaration, not proof of testing that release.
- The website on physical phones and non-Chromium browsers.

Version 0.2.0 received an informal report of successful everyday Chrome use without itemized steps. It does not establish manual acceptance of 0.2.1. Firefox and Safari are not supported ports, and browser-store distribution is deferred.
