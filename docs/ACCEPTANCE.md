# Testing and compatibility

The current development build is **0.2.2**. It adds an About and help area to 0.2.1. Its background worker, capture script, export and model code and icons are byte-identical to 0.2.1; only `manifest.json` (the version) and the three workbench UI files changed, as the two per-file receipts show. The 0.2.2 unit, presentation, website and functional browser checks passed on September 25–26, 2026. This is evidence for those workflows and environments, not universal browser/site compatibility or a complete accessibility certification.

## Current build (0.2.2)

- Package: [`artifacts/link-meteor-0.2.2.zip`](../artifacts/link-meteor-0.2.2.zip), 198835 bytes.
- SHA-256: `ceb6b778a0f93a6651e9c036fb6535773919ffa78b7ad4b88c692d35983b4e9d`.
- Product source: `4b5261477381c4036d9bcd48e5e3bbd0ec5ec699`.
- [Per-file receipt](../artifacts/link-meteor-0.2.2.sha256.json): 13 package members. Changed from 0.2.1: `manifest.json`, `ui/workbench.html`, `ui/workbench.css`, `ui/workbench.js`.

| Check | Result | What it establishes and its limits |
| --- | --- | --- |
| `npm test` | 26 passing tests | Same model, export, storage and race tests as 0.2.1, run on the 0.2.2 source. [Output](../artifacts/evidence-0.2.2/node-tests.txt). |
| `tests/visual-browser.mjs` | 11 checks, pass | The loaded 0.2.2 extension at widths from 320 to 1440 px, labels, focus and sampled contrast, plus About and help: six exact links that open in a new tab with `noopener`, the version read from the manifest, closed by default, a keyboard path at compact width, and no page opened automatically. [Results](../artifacts/evidence-0.2.2/visual-results.json), [About screenshot](../artifacts/evidence-0.2.2/workbench-about.png), [panel width](../artifacts/evidence-0.2.2/panel-about.png). |
| `tests/site-check.mjs` | Pass | Six pages across widths and light/dark themes, links, structure, sampled contrast, keyboard menu, interactive demo, 404 handling, export preview and the two videos: controls with no autoplay or loop, nothing loaded before play, local poster, MP4 and WebVTT captions, transcripts, phone gutters, and both files playing in Chrome for Testing. [Results](../artifacts/evidence-0.2.2/site-results.json). |
| `node scripts/sync-site.mjs --check` | Pass | The site's ZIP, hashes, icons, export modules, shared header/footer and version metadata match the 0.2.2 build. |
| `tests/browser.mjs` | 27/27 | The same capture, clipboard, collection, filtering, Undo, export and restart checks as 0.2.1, on the loaded 0.2.2 extension in a visible test browser. [Results](../artifacts/evidence-0.2.2/browser-results.json); its workbench screenshots are in [`browser-screens/`](../artifacts/evidence-0.2.2/browser-screens/) because the visual suite uses the same filenames. |
| `tests/extended-browser.mjs` | 8/8 | 5,037 captured occurrences with bounded rendering and complete export, an actual bookmark folder, the bounded opener and the 20-link cap, grouped details in increments of 100, and draft preservation. [Results](../artifacts/evidence-0.2.2/extended-browser-results.json). |
| `tests/site-browser.mjs` | Pass | All eight practice answer keys: 7, 9, 10, 12, 7, 15, 3 and 5. The whole page is 95 links, up from 85 in 0.2.1 because this build's site header and footer add 10 links. Empty anchors, separate accessible labels, formula/markup strings, frame/shadow provenance and mixed capture outcomes. [Results](../artifacts/evidence-0.2.2/site-browser-results.json). |
| `tests/audit-granted-regressions.mjs` | 4/4 | Keyboard focus on tab checkboxes, a changed collection destination, overlapping Add/Review saving once, and a saved receipt staying with its destination. [Results](../artifacts/evidence-0.2.2/granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | The seven formats downloaded by `tests/browser.mjs`, read independently: 53 exact anchor/URL pairs, including two empty anchors and one formula-like label, with every XLSX cell a string. openpyxl 3.0.10 read the XLSX, not Microsoft Excel. [Results](../artifacts/evidence-0.2.2/workbook-results.json). |
| `tests/permission-browser.mjs` | 3/3, run last | Revoking the fixture-origin grant prunes the saved hold origin and its content registration, stops the loaded gesture, and makes capture report denied. [Results](../artifacts/evidence-0.2.2/permission-browser-results.json). The native Deny button was not tested. |

The functional suites used a new profile whose optional grants (tabs, the local fixture origin and bookmarks) were requested by the product itself, each with an active user gesture, in a visible Chrome for Testing window, with the project owner present to click Allow. Each request resolved within about three seconds. The harness can't observe the native click, so this is not an itemized native Allow/Deny test.

**Diagnostic runs.** The first visible run of `tests/browser.mjs` failed its sixth check. The live badge had reached 5 links, but after release the card read `3 links selected` (`AssertionError: '3 links selected' !== '5 links selected'`, line 61). A screenshot taken just before release shows the selection's corner displaced to a point unrelated to the drag. That is consistent with the Mac's real pointer resting over the visible test window. A second run without a visible window passed that check, but it can't complete the later wheel-scroll check, which needs a rendered window. After the project owner was asked to move the pointer off the test window, a third, visible run passed 27/27. The download verifier's first attempt failed only because the first browser run stopped before writing its exports. The first two runs are kept in [`artifacts/evidence-0.2.2/diagnostics/`](../artifacts/evidence-0.2.2/diagnostics/).

## Earlier build (0.2.1)

- Package: [`artifacts/link-meteor-0.2.1.zip`](../artifacts/link-meteor-0.2.1.zip), 193346 bytes.
- SHA-256: `231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9`.
- Product source: `e8e69cf734ed750ee6b792cc3cae1f9bf898ce62`.
- [Per-file receipt](../artifacts/link-meteor-0.2.1.sha256.json): all 13 package members match the extension source. Later documentation changes do not change the packaged product.

Tests used isolated Chrome for Testing profiles on macOS with synthetic webpages and collection data. Functional suites exercised the loaded extension, not a reconstruction of its UI. Scripted API failures and presentation previews are identified separately below.

## Functional suites (0.2.1)

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

The 0.2.2 visual and site results are listed above. The 0.2.1 [visual results](../artifacts/audit-0.2.0/repair-ui/visual-results.json) cover responsive widths, long names, labeled controls, keyboard focus and sampled contrast. They are not a complete screen-reader or WCAG audit. Panel-width screenshots render the workbench at a compact width; they do not prove native side-panel framing or resizing.

The 0.2.1-era [site results](../artifacts/audit-0.2.0/repair-ui/site-results.json) checked five pages across five widths and light/dark themes, internal links, semantic structure, sampled contrast, keyboard menu use, interactive demo, nested 404 handling and export preview contents. These are automated Chromium checks.

The site's two videos were recorded with the 0.2.2 build, including selection on the practice page with the extension's own injected script. [`media/README.md`](../media/README.md) says which scenes are recordings and which are illustrations. The videos are demonstrations, not test evidence. The site is available at [Link Meteor](https://ryanjosephkamp.github.io/link-meteor/); real-device and non-Chromium testing remain separate.

`node scripts/sync-site.mjs --check` verifies the site's package, hashes, icons, export modules, shared header/footer and version metadata against current source. `tests/design-preview.mjs` and `tests/overlay-preview.mjs` use simulated extension APIs for presentation work; their images are not functional acceptance evidence.

The earlier 0.2.0 package has separate [historical test results](../artifacts/evidence/browser-results.json). Those results should not be substituted for the current build's evidence. Diagnostic failures remain available alongside successful runs, rather than being described as passing checks.

## Reproduce

See the [README](../README.md#develop-and-verify) for Node, installed Playwright discovery, fixture server settings and isolated profile setup. The browser suite resets collections in the selected test profile: never use a personal profile. Prepare actual optional permissions with `tests/prepare-grants.mjs` before functional suites, and run `tests/permission-browser.mjs` last because it revokes the fixture-origin grant.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` also check OOXML and independent workbook parsing. Without openpyxl, the reader reports structural-only coverage. Actual downloaded files are under [`artifacts/audit-0.2.0/resume-01/exports/`](../artifacts/audit-0.2.0/resume-01/exports/).

## Remaining compatibility and human checks

- Everyday Google Chrome 0.2.2 and real research/admin sites.
- Native Allow/Deny interactions and native side-panel width/resizing.
- Microsoft Excel and other spreadsheet applications, beyond file-reader checks.
- Screen readers and other assistive technologies.
- Windows/Linux, native shortcuts on those systems and Chrome 116. The manifest's minimum version is a declaration, not proof of testing that release.
- The website on physical phones and non-Chromium browsers.

Version 0.2.0 received an informal report of successful everyday Chrome use without itemized steps. It does not establish manual acceptance of 0.2.1 or 0.2.2. Firefox and Safari are not supported ports, and browser-store distribution is deferred.
