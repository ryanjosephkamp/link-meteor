# Testing and compatibility

The current development build is **0.3.0**. It adds:
- one optional choice to allow Link Meteor on all sites, with exceptions and a Command or Ctrl hold key;
- a welcome card and more actions on the capture card;
- opening up to 500 links;
- export file names and formatted workbooks;
- existing bookmark folders;
- backup and restore.

Its automated checks passed on September 27, 2026, in Chrome for Testing on macOS, both without optional grants and after the project owner clicked Allow on every native prompt. The owner then checked it by hand in everyday Chrome, where every item passed, and in Brave and Microsoft Edge, where everything worked. This is evidence for those workflows and environments, not universal browser/site compatibility or a complete accessibility certification.

## Current build (0.3.0)

- Package: [`artifacts/link-meteor-0.3.0.zip`](../artifacts/link-meteor-0.3.0.zip), 368539 bytes.
- SHA-256: `25463687d2f0a7b9e280de7d4f905753cb9b8cc57b359129937f8ea5e98302c7`.
- Product source: `src/` as tested at `bd3f6b59123868f6534a9a7a25135442859a7eae` (release candidate 2), unchanged when packaged at `a1901dbc5af70ac50b66134a19c22a8bf434dd6a`.
- [Per-file receipt](../artifacts/link-meteor-0.3.0.sha256.json): 35 package members, each matching `src/`. The ZIP's contents are also byte-identical to the copy the owner checked by hand.
- Evidence: [`artifacts/evidence-0.3.0-rc2/`](../artifacts/evidence-0.3.0-rc2/README.md). Earlier stages are kept in [release candidate 1](../artifacts/evidence-0.3.0-rc1/README.md), whose granted run found three issues that release candidate 2 fixes, and the [foundation](../artifacts/evidence-0.3.0/README.md).

### Checks without optional grants

Headless Chrome for Testing 151, fresh task-owned profiles.

| Check | Result | What it establishes and its limits |
| --- | --- | --- |
| `npm test` | 94/94 | Model, settings migration, backup format, export names and content, opening limits, storage and race tests. Now that the ZIP exists, this includes the check that its members match `src/`. [Output](../artifacts/evidence-0.3.0-release/node-tests.txt). |
| `tests/access-browser.mjs` | 20/20 | The welcome card, Site access settings, opening tiers, the capture card through Chrome's real toolbar action, and the offer to allow all sites when Chrome hides a page, with Chrome's prompt stubbed to decline. After an in-place reinstall with a page open, region selection still works without a reload. [Results](../artifacts/evidence-0.3.0-rc2/access-browser-results.json). |
| `tests/access-content.mjs` | 22/22, simulation | The page script in ordinary pages with real input and a stubbed `chrome` object: the Command and Ctrl hold key, card shortcuts, unticking links, and the opening confirmations and refusal above 500. [Results](../artifacts/evidence-0.3.0-rc2/access-content-results.json). |
| `tests/exports-browser.mjs` | 13/13 | File names and name settings, the formatted workbook read by openpyxl, the bookmark folder picker with a stand-in background, and CSV and TSV byte for byte against 0.2.2. [Results](../artifacts/evidence-0.3.0-rc2/exports-browser-results.json). |
| `tests/backup-browser.mjs` | 19/19 | Backup, preview, merge, replace, Undo, invalid files, Select all, Remove all in this view, Empty this collection, and a synthetic 20,000-link restore. [Results](../artifacts/evidence-0.3.0-rc2/backup-browser-results.json). |
| `tests/capture-page-access.mjs` | Pass | *Capture this page* after the tab moves to a new site, driven through Chrome's own toolbar action. [Results](../artifacts/evidence-0.3.0-rc2/capture-page-access.json). |
| `tests/audit-overlay.mjs`, `audit-actions.mjs`, `audit-regressions.mjs` | 4, 9 and 7 checks, pass | Earlier fixes still hold. [Overlay](../artifacts/evidence-0.3.0-rc2/audit-overlay.json), [actions](../artifacts/evidence-0.3.0-rc2/audit-actions.json), [regressions](../artifacts/evidence-0.3.0-rc2/audit-regressions.json). |
| `tests/visual-browser.mjs` | 13 checks, pass | Widths from 320 to 1440 px, labels, focus and sampled contrast in both themes, including the welcome card, Site access, the stronger opening confirmation and the all-sites note. The lowest measured ratio is 5.1:1. [Results](../artifacts/evidence-0.3.0-rc2/visual-results.json). |

### Allow clicks and granted suites

The owner clicked Allow on every native prompt in visible Chrome for Testing windows, and each request came from the product itself with an active user gesture:
- **Per-site profile, 4 prompts:** tabs, the fixture site, bookmarks, and a newly visited site, which *Capture this page* asked for in the same click.
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks.

The suites then ran in visible windows, with the owner's pointer parked away from them.

| Check | Result | What it establishes and its limits |
| --- | --- | --- |
| `tests/browser.mjs` | 27/27 | Capture, clipboard, collections, filtering, Undo, exports and restart persistence, as in 0.2.2. [Results](../artifacts/evidence-0.3.0-rc2/browser-results.json). |
| `tests/extended-browser.mjs` | 9/9 | Includes saving into an existing bookmark folder with Chrome's real bookmark API. [Results](../artifacts/evidence-0.3.0-rc2/extended-browser-results.json). |
| `tests/site-browser.mjs` | Pass | All eight practice answer keys, and 95 links for the whole page. [Results](../artifacts/evidence-0.3.0-rc2/site-browser-results.json). |
| `tests/audit-granted-regressions.mjs` | 4/4 | [Results](../artifacts/evidence-0.3.0-rc2/granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | openpyxl 3.0.10 read the formatted workbook, not Microsoft Excel. [Results](../artifacts/evidence-0.3.0-rc2/workbook-results.json). |
| `tests/access-granted.mjs` | 10/10 | Covers:<br>• hold-drag on a second site with no prompt;<br>• Command-drag, while a plain Command-click still opens the link;<br>• exceptions without a reload;<br>• capture on a never-visited site;<br>• named tab groups;<br>• the card's bookmark folder;<br>• the all-sites switch staying on while it saves.<br>A page opened as the browser starts gets hold-drag on the first try. [Results](../artifacts/evidence-0.3.0-rc2/access-granted-results.json). |
| `tests/permission-browser.mjs` | 10/10, run last | Per-site hold-drag works before revocation and stops after it. Removing all-sites access returns to per-site mode, following what Chrome still grants. That can include removing a site allowed one at a time, which Chrome also takes away. [Results](../artifacts/evidence-0.3.0-rc2/permission-browser-results.json). |

### Chrome 116

The manifest declares Chrome 116 as the oldest supported version. The checks that need no grants were run on Chrome for Testing 116.0.5845.96 for macOS:
- **Passed:** `access-content` 22/22, `exports-browser` 13/13, `backup-browser` 19/19, the three audits, and `visual-browser` 13/13 (on a rerun, after one timing flake).
- **Partly run:** `access-browser` passed its first 5 checks.
- **Couldn't run:** `capture-page-access`, and the rest of `access-browser`. They press Chrome's toolbar button through DevTools commands (`Extensions.triggerAction` and `Extensions.loadUnpacked`) that Chrome 116 doesn't have.

No product failure was found, and every extension API and web feature the source uses was available by Chrome 116, so the minimum stays at 116. The granted suites were not run on 116. [Details](../artifacts/evidence-0.3.0-rc2/chrome-116/README.md).

## Hands-on use (0.3.0)

On September 27, 2026, the project owner loaded the release candidate 2 copy, byte-identical to this ZIP, in everyday Google Chrome on macOS. They worked through a 12-item walkthrough and reported that every item passed. These are human observations, reported for the walkthrough as a whole rather than item by item, and kept separate from the automated results above.

| Area | Result |
| --- | --- |
| Welcome card: Allow on all sites, with Chrome's prompt | Passed |
| Hold-drag on a real site, with the Z key and then Command; a plain Command-click still opens a link | Passed |
| *Capture this page* after the tab moves to another site, with the side panel open | Passed; the 0.2.2 friction is gone |
| Never on these sites: add a site, then remove it | Passed |
| Capture card: open more than 20 links, open as a tab group, change the destination | Passed |
| Excel export: file name, bold frozen header, filters, clickable links, About sheet, opened in Microsoft Excel | Passed |
| Save into an existing bookmark folder, skipping links already there | Passed |
| Backup, delete a collection, restore by Merge, Undo | Passed |
| Chrome's own site-access menu set to On click: hold-drag stops and Link Meteor explains why | Passed |
| All sites off, then a native Deny on *Capture this page* reports the denial | Passed |

Windows and Linux were not part of this check.

**Brave and Microsoft Edge.** The owner then tested 0.3.0 by hand in Brave and Microsoft Edge on macOS, as thoroughly as they could. Everything worked as intended in both, as in Chrome. This was reported as a whole, without itemized steps or browser versions.

## Earlier build (0.2.2)

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
| `tests/capture-page-access.mjs` | Pass | Reproduces *Capture this page* after the tab moves to a new site: a toolbar click on the first site allows capture (37 links); after the tab moves, capture is denied; a toolbar click on the new page allows it again (38 links) without adding lasting site access. Toolbar clicks are Chrome's own action, driven through the DevTools protocol in a fresh temporary profile; the full view in its own window stands in for the open side panel. [Results](../artifacts/evidence-0.2.2/capture-page-access.json). |

The functional suites used a new profile whose optional grants (tabs, the local fixture origin and bookmarks) were requested by the product itself, each with an active user gesture, in a visible Chrome for Testing window. The project owner confirmed clicking Allow on each native prompt: six clicks in all, three for this profile and three for the video-recording profile. Each request resolved within about three seconds.

**Diagnostic runs.** The first visible run of `tests/browser.mjs` failed its sixth check. The live badge had reached 5 links, but after release the card read `3 links selected` (`AssertionError: '3 links selected' !== '5 links selected'`, line 61). A screenshot taken just before release shows the selection's corner displaced to a point unrelated to the drag. That is consistent with the Mac's real pointer resting over the visible test window, and the project owner confirmed it was. A second run without a visible window passed that check, but it can't complete the later wheel-scroll check, which needs a rendered window. After the project owner was asked to move the pointer off the test window, a third, visible run passed 27/27. The download verifier's first attempt failed only because the first browser run stopped before writing its exports. The first two runs are kept in [`artifacts/evidence-0.2.2/diagnostics/`](../artifacts/evidence-0.2.2/diagnostics/).

### Hands-on use (0.2.2)

These results come from the project owner using 0.2.2 by hand in everyday Google Chrome on macOS, on September 26, 2026. They are human observations, reported without itemized steps, and are kept separate from the automated results above.

| Area | Result |
| --- | --- |
| Everyday Chrome on real sites | Works. One friction: *Capture this page* on a newly visited site (Wikipedia) reported missing site access until hold-key drag was turned on for that site, which grants lasting access. The cause and a tested workaround are above (`tests/capture-page-access.mjs`) and in the install page's troubleshooting. |
| Native permission prompts | The owner clicked Allow on all six native prompts during test preparation, and checked that the native Deny button works as intended. |
| Native side-panel frame | Looks and behaves as expected. |
| Microsoft Excel | Downloaded XLSX files open correctly in Excel. |
| Windows and Linux | Not tested; a known gap for now. |

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

The 0.3.0 visual results are listed above, and the site checks for the 0.3.0 release are in [`artifacts/evidence-0.3.0-release/`](../artifacts/evidence-0.3.0-release/README.md). The site's four product screenshots still come from the 0.2.2 `tests/site-browser.mjs` run, and their alt text describes what each one shows, including the 0.2.2 version. The 0.2.1 [visual results](../artifacts/audit-0.2.0/repair-ui/visual-results.json) cover responsive widths, long names, labeled controls, keyboard focus and sampled contrast. They are not a complete screen-reader or WCAG audit. Panel-width screenshots render the workbench at a compact width; they do not prove native side-panel framing or resizing.

The 0.2.1-era [site results](../artifacts/audit-0.2.0/repair-ui/site-results.json) checked five pages across five widths and light/dark themes, internal links, semantic structure, sampled contrast, keyboard menu use, interactive demo, nested 404 handling and export preview contents. These are automated Chromium checks.

The site's two videos were recorded with the 0.2.2 build, including selection on the practice page with the extension's own injected script. [`media/README.md`](../media/README.md) says which scenes are recordings and which are illustrations. The videos are demonstrations, not test evidence. The site is available at [Link Meteor](https://ryanjosephkamp.github.io/link-meteor/); real-device and non-Chromium testing remain separate.

`node scripts/sync-site.mjs --check` verifies the site's package, hashes, icons, export modules, shared header/footer and version metadata against current source. `tests/design-preview.mjs` and `tests/overlay-preview.mjs` use simulated extension APIs for presentation work; their images are not functional acceptance evidence.

The earlier 0.2.0 package has separate [historical test results](../artifacts/evidence/browser-results.json). Those results should not be substituted for the current build's evidence. Diagnostic failures remain available alongside successful runs, rather than being described as passing checks.

## Reproduce

See the [README](../README.md#develop-and-verify) and [`AGENTS.md`](../AGENTS.md) for Node, installed Playwright discovery, fixture server settings and isolated profile setup. `npm run check` runs every check that needs no grants in one command. The browser suite resets collections in the selected test profile: never use a personal profile. Prepare actual optional permissions with `tests/prepare-grants.mjs` before functional suites, and run `tests/permission-browser.mjs` last because it revokes the fixture-origin grant.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` also check OOXML and independent workbook parsing. Without openpyxl, the reader reports structural-only coverage. Actual downloaded files are under [`artifacts/audit-0.2.0/resume-01/exports/`](../artifacts/audit-0.2.0/resume-01/exports/).

## Remaining compatibility and human checks

- A wider range of real research and admin sites, beyond the owner's hands-on use.
- Native side-panel resizing, beyond the owner's check of its frame.
- Spreadsheet applications other than Microsoft Excel.
- Screen readers and other assistive technologies.
- Windows and Linux, and native shortcuts on those systems.
- Chrome 116 by hand, its toolbar-button behavior, and the checks that need Allow clicks. The automated checks that could run there passed (see above).
- Chromium-based browsers other than Chrome, Brave and Edge, and Brave and Edge on Windows and Linux.
- The website on physical phones and non-Chromium browsers.

Version 0.2.0 received an informal report of successful everyday Chrome use without itemized steps. The 0.3.0 hands-on results above are the owner's report for the current build. Firefox and Safari are not supported ports. Chrome Web Store submission is planned for 0.3.0.
