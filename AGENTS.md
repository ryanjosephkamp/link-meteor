# Working on Link Meteor

Instructions for coding agents and people working in this repository. Link Meteor is a Chrome Manifest V3 extension that captures links with their anchor text, organizes local collections and exports them. It has no server, no account, no telemetry, and no package dependencies. It ships one third-party library as plain files, PDF.js, in `src/vendor/pdfjs/`. The static website lives in `site/`.

## Code map

| Path | What it holds |
| --- | --- |
| `src/manifest.json` | Version, permissions (optional ones are requested at runtime), minimum Chrome version. |
| `src/background.js` | The service worker's entry point: messages, context menus, the command, install and startup. |
| `src/background/` | Service worker areas: `store.js` (the one serialized queue for saved state), `hold.js` (hold-key drag, script registration, all-sites access), `card.js` (the on-page capture card's actions), `open.js` (opening up to 500 links), `downloads.js` (downloading the files behind links, and the Download linked file menu item), `menus.js` (the right-click and toolbar menus), `tabs.js` (saving tabs as links), `citations.js` (page citation tags: the reader Save tabs as links runs, and what is kept), `theme.js` (the toolbar icon), `diagnostics.js` (Copy diagnostics), `imports.js` (saving an import as one batch, and its Undo), `transfer.js` (moving and copying links to another collection, and its Undo), `frames.js` (Capture this page in every frame Link Meteor has access to, and Allow these sites), `frame-join.js` (joining the frames' answers and the report's words, pure), `runs.js` (runs: Scroll to the end first, Follow Next, Capture selected pages, and getting the PDF files behind chosen links; the engine, and what each kind does in one step), `bookmarks.js`, `backup.js`, `urls.js` (which addresses can be captured, and what a PDF's or a file's tab is told instead). |
| `src/content/capture.js` | The page script: region selection, hold-key drag and the capture card, in a shadow root; the collector, which also reads closed components; and, for runs, the scroll loop, the page's Next link and the run's notice. It is injected on demand (into every frame for Capture this page, where a frame's copy only reads links) and registered on sites where hold-key drag runs. |
| `src/core/` | Pure modules with no Chrome or DOM access: `model.js` (state, reducer, migration, backup format, moving and copying links), `export.js` (every export format, file names and rich links), `xlsx.js` (the workbook writer), `themes.js` (every theme's tokens and card colors), `files.js` (which links are files and which are PDFs, and how downloads and a ZIP's entries are named), `identifiers.js` (DOI, arXiv, PubMed, PMC and ISBN read from addresses, and the citation each link uses), `insights.js` (a collection's counts for the Insights view), `imports.js` (reading CSV, TSV, lists and workbooks for Import links, and planning an import), `cite.js` (BibTeX, RIS, CSL-JSON, the annotated bibliography and the Obsidian note), `pdf.js` (what is read from a PDF: links with their words and pages, what the PDF says about itself, combining), `zip.js` (the ZIP writer), `lookup.js` (Page details lookup: which request an identifier needs, and each service's answer as a citation). |
| `src/vendor/pdfjs/` | PDF.js as shipped: two unmodified files, its license, and a README with the version and hashes. Only `scripts/vendor-pdfjs.mjs` changes them; `tests/vendor.test.mjs` checks them. |
| `src/ui/lookup-frame.*` | The sandboxed page that makes lookup requests: the only part of Link Meteor that can reach the network, and only three addresses. |
| `src/ui/workbench.*`, `src/ui/workbench/` | The side panel and full view: one page in two widths, split into area modules. For 0.6.0: `pdf-reader.js` (PDF.js, loaded on first use, in one worker), `pdf-tab.js` (a PDF's file through a tab), `pdf.js` (Capture this PDF, a PDF file through Import links, and the preview), `runs.js` (the run choices, progress, report and the Capture their pages panel), `frames.js` (Allow these sites in the capture report), `lookup.js` (Page details lookup; the only module that creates the lookup frame), `pdf-files.js` (the Export panel's one ZIP and one combined PDF). |
| `scripts/` | `build.mjs` (copies `src/` to `dist/`), `package.mjs` (deterministic ZIP and receipt), `verify-package.mjs`, `sync-site.mjs`, `release-files.mjs` (the allowlist), `check.mjs`, `vendor-pdfjs.mjs` (a maintainer's step: fetches one exact PDF.js release, checks its integrity value, and copies it). |
| `tests/` | `*.test.mjs` unit tests (Node's test runner), browser suites (`*.mjs`), `helpers/browser.mjs` (Playwright launch, fixture server, build fingerprints), `helpers/action.mjs` (Chrome over a DevTools pipe, for the toolbar action), `helpers/pdf.mjs` (reads PDFs in Node with the shipped PDF.js), `debug-session.mjs`, and `fixtures/` (`fixtures/pdf/make.mjs` writes the PDF fixtures with no packages; `fixtures/lookup/` holds recorded lookup answers). |
| `docs/` | `CONTRACTS.md` (message and data contracts: read it before changing messages or stored data), `PRIVACY.md`, `SCOPE.md`, `DESIGN.md`, `ACCEPTANCE.md` (what was tested, with evidence links). |
| `artifacts/` | Released ZIPs, their `.sha256.json` receipts, and `evidence-<version>/` folders with each release's results. |
| `site/`, `media/` | The GitHub Pages site and the scripts that recorded its videos. |

`docs/alignment/` (if present) holds the owner's local, unpublished planning notes, including the roadmap. Read it before planning work, but never commit it or quote it in public files.

## Commands

Node.js 22 or newer. There is nothing to install for the extension itself.

```sh
npm run build                      # copy src/ to dist/; load dist/ with "Load unpacked"
npm test                           # unit tests
npm run check -- .scratch/check    # everything that needs no grants; results and logs in that folder
npm run debug                      # the extension in a fresh profile, streaming its background console and errors
npm run package                    # the ZIP and receipt for this version (clean tree only)
node scripts/sync-site.mjs --check # the site matches the packaged build
```

Browser checks need the Playwright library and its Chromium (Chrome for Testing). They are not package dependencies: the helpers use `require('playwright')`, then `LINK_METEOR_PLAYWRIGHT`, then a known local runtime path. In CI: `npm install --no-save playwright@1.62.1 && npx playwright install chromium`. The workbook checks need Python 3 with `openpyxl`.

`npm run check` accepts `--only a,b`, `--skip a,b`, `--keep-profiles` and `--minutes n` (per-check timeout, default 20). `npm run debug` accepts `--headless`, `--seconds n`, `--url <page>` (repeatable), `--tabs`, `--eval "<expression in the background>"` and `--log <file>`. The workflow `.github/workflows/check.yml` runs `npm run check` on macOS, Windows and Linux for every pull request.

## Test suites

**No grants needed** (all run by `npm run check`, headless, each in a fresh profile):

| Suite | Covers |
| --- | --- |
| unit (`tests/*.test.mjs`) | Model, migration, backup format, exports and citation formats, moving and copying, opening limits, storage and races; PDFs read in Node with the shipped PDF.js, the ZIP writer, the vendored files' hashes, lookup plans and answers, frames joined, and runs (the queue, pacing, Stop, a restarted worker) with a clock the test moves. |
| `access-browser` | Welcome card, Site access, opening tiers, the capture card through Chrome's real toolbar action, a second toolbar press closing the side panel, restart in place. |
| `capture-page-access` | *Capture this page* after the tab moves to a new site. |
| `access-content` | The page script with a stubbed `chrome` object (a simulation, with real input events), including closed shadow roots and frames. |
| `exports-browser`, `backup-browser` | Export names and workbooks; backup (with the last backup's date), restore, Undo and removing all. |
| `downloads-browser` | Download files in the Export panel, Download in a link's details and files left waiting, with Chrome's prompt stubbed; nothing downloads. |
| `reading-browser` | Reading status and stars (details, rows, selection, Undo), the Reading and Starred only view options, and Insights against `insights()`; 320 px and contrast. |
| `imports-browser` | Import links: files through the file chooser (a PDF among them), pasted links and a bookmark folder (Chrome's prompt stubbed), the mapping, the preview's skips, Undo, 320 px and contrast. |
| `move-browser` | Move to… and Copy to…: the panel's preview, everything that travels, columns matched or created, borrowed citations, Undo for both collections, a link's details, 320 px and contrast. |
| `pdf-browser` | The PDF reader inside the extension (loaded only when used, one module worker, every fixture as Node reads it, combining), and Import links with a PDF file: the preview, drops, every refusal, Cancel while reading, the keyboard, 320 px and contrast. On Chrome 116 it proves the shims. |
| `pdf-tab-browser` | A PDF's file through a tab, with only the toolbar's temporary access (Chrome's real toolbar action): a PDF in a tab, PDFs on a page's own site including one sent as a download, and each refusal; then Capture this PDF in the workbench: preview, add, Undo, a PDF without `.pdf` in its address, a local PDF's tab, Select a region on a PDF, 320 px and contrast. Nothing downloads. |
| `lookup-browser` | Page details lookup with the test answering in the services' place: nothing requested and no frame while it is off; the sandboxed frame (one request per identifier, origin `null`, no cookies, no referrer, everything else refused, sealed from Chrome's APIs and storage); a run's requests in order and 350 ms apart; what is saved, Undo, Stop, "too many requests", unreadable answers; 320 px and contrast in every theme. No test contacts a real service. |
| `coverage-browser` | Closed components (Capture this page, a region, the right-click lookup) and frames from other sites with only the toolbar's access: the report names their sites and offers Allow these sites (Chrome's prompt stubbed); frames still loading; 320 px and contrast. |
| `pdf-files-browser` | *Download as one ZIP* and *Combine into one PDF…* on the loaded extension, with Chrome's real toolbar action and Chrome's prompt stubbed: same-site PDFs fetched for real (one sent as a download), other sites "No access"; the ZIP byte for byte (also read by Python's `zipfile`); the combined PDF read back; the panel by keyboard, files from the chooser and a drop; the limits; Stop; 320 px and contrast. Every download lands in the profile's own folder. |
| `scroll-content` | The page script's part of a run, with a stubbed `chrome`: Scroll to the end first on endless, lazy, never-ending and self-trimming feeds, each cap, Stop and Escape, scrolling back; the page's Next link in its spellings; the run's notice at 320 px and its contrast. |
| `runs-browser` | Runs on the loaded extension with Chrome's real toolbar action: Scroll to the end first, Follow Next and each way it ends, Stop, one batch and Undo, the report; the *Capture their pages…* panel with Chrome's prompt stubbed; 320 px and contrast in every theme. |
| `audit-overlay`, `audit-actions`, `audit-regressions` | Earlier fixes stay fixed. |
| `visual-browser` | Widths from 320 px, labels, focus, measured contrast, screenshots. Needs `LINK_METEOR_SEED_JSON`; `check` supplies one. |
| `site-check`, `sync-site --check` | The website, and its match with the packaged build. |

**Need a person's Allow clicks** on Chrome's native prompts, never run in CI:
1. First prepare grants in a new profile with `LINK_METEOR_TEST_PROFILE=<new-name> node tests/prepare-grants.mjs`. Add `LINK_METEOR_GRANTS=all-sites` for the all-sites profile. The owner, or computer use at the owner's direction, clicks Allow.
2. Then run `browser`, `extended-browser`, `site-browser`, `audit-granted-regressions`, `verify-downloads.py` and `access-granted` in those profiles, and `downloads-granted` in the per-site profile, with the same fixture port as its preparation.
   - 0.6.0 adds two suites to the per-site profile, visible, after the others and before `permission-browser`: `frames-granted` (one native prompt naming `localhost` and `third.localhost`, printed as `awaiting-native-allow`) and `runs-granted` (one native prompt, when the script clicks *Allow these 2 sites*). Each removes its two grants afterward. `access-granted` (all-sites profile, no new prompt) also covers a PDF captured without a toolbar click, frames from other sites, selected pages, and PDF files on two sites into one ZIP and one combined PDF.
3. Run `permission-browser` last, because it removes grants.

Visible runs need the real mouse pointer parked away from the test windows: ask before starting one.

## Test settings

| Variable | Meaning |
| --- | --- |
| `LINK_METEOR_EVIDENCE_DIR` | Where suites write results (default `artifacts/evidence`). |
| `LINK_METEOR_TEST_PROFILE`, `LINK_METEOR_VISUAL_PROFILE` | Profile name under `.scratch/`. |
| `LINK_METEOR_FIXTURE_PORT` | The local fixture server's port (default `52478`). The same server is a second site at `http://localhost:<port>` (`fixture.other`), and a third at `http://third.localhost:<port>`. It serves `tests/fixtures/site/**` at `/site/…` and the PDF fixtures at `/pdf/…`, `/pdf-plain/…`, `/pdf-download/…`, `/pdf-moved/…` and `/pdf-signin/…`; a suite can pass its own `routes`. |
| `LINK_METEOR_EXTENSION_PATH` | Load another unpacked build instead of `dist/`. |
| `LINK_METEOR_CHROME_PATH` | Run on another Chrome for Testing build, such as the oldest supported one; adds `--headless=new`. |
| `LINK_METEOR_PLAYWRIGHT`, `LINK_METEOR_PYTHON` | Where Playwright and Python are. |
| `LINK_METEOR_SEED_JSON` | The export the visual suite shows. |
| `LINK_METEOR_GRANTS`, `LINK_METEOR_HEADED` | Grant preparation and visible runs. |

## Rules

- **Downloads.** No test downloads into a person's Downloads folder. `launch()` sends every profile's downloads to `.scratch/<profile>-downloads`. On macOS, every test browser also gets a home folder under `.scratch/` (`browserHome`), because Chrome for Testing briefly writes a temporary file to the system's Downloads folder for each download. With `chromeDownloads` (Chrome's own naming, for `downloads-granted`), `launch()` first checks that Chrome's settings report the profile's folder.
- **Profiles.** Use task-owned profiles under `.scratch/` only. Never use a personal Chrome profile, its collections, or an installed copy in `artifacts/link-meteor-*/` (those folders belong to the owner). A profile belongs to one build: the harness refuses a profile whose build changed, so use a new name.
- **Permissions are real.** Never forge grants, edit Chrome's permission files, or treat headless grants as proof of a native prompt. Every permission needs a reason in the UI, `docs/PRIVACY.md`, `site/privacy.html` and `CHROMEWEBSTORE.md` before it ships. Optional access is asked for only through an explained choice, never at install.
- **Privacy.** Extension pages keep `connect-src 'none'`. A feature that contacts any site must be opt-in and state what it sends where. No telemetry. Only the sandboxed lookup frame can make a request, to the three addresses in its policy; no test may contact them (answer in their place, as `lookup-browser` does).
- **PDF.js.** Never edit the files in `src/vendor/pdfjs/` by hand. To update, run `node scripts/vendor-pdfjs.mjs <version>`, then the PDF suites on the current Chrome and on Chrome 116.
- **Ports.** Drive Chrome through the DevTools pipe or port 0, never a fixed debugging port. Port 9333 on the owner's Mac belongs to another project.
- **Builds and releases.** A changed build gets a new version and a new ZIP; never relabel changed bytes. Package from a clean tree. Record results in `artifacts/evidence-<version>/` with a README, and summarize them in `docs/ACCEPTANCE.md`. Agents open pull requests; merging to `main`, tagging, GitHub releases, the Pages deployment and browser-store submissions happen only when the owner asks for them.
- **Public files** contain no local paths, private notes or handoff material. Write in plain American English.

## Common failures

| Symptom | Cause and fix |
| --- | --- |
| "Build changed since this profile was initialized" | The profile was made with another build. Use a fresh `LINK_METEOR_TEST_PROFILE`. |
| A reused or copied profile behaves like an older build | Chrome caches the service worker per profile while the version is unchanged. Always start from a fresh profile. |
| `EADDRINUSE 127.0.0.1:52478` | A leftover test process holds the fixture port. Stop only processes your own tests started, or set `LINK_METEOR_FIXTURE_PORT`. |
| "Chrome did not answer over the DevTools pipe" | A leftover Chrome, or a Chrome too old for the pipe helper's flags. |
| `'Extensions.triggerAction' wasn't found` | That Chrome predates the toolbar-action DevTools commands (Chrome 116 does). Toolbar suites can't run there. |
| The service worker never starts under Playwright on an older Chrome | Before Chrome 132, bare `--headless` is the old mode, which runs no extensions. `LINK_METEOR_CHROME_PATH` adds `--headless=new`. |
| The extension disappears after `chrome.runtime.reload()` in a test | Chrome for Testing unloads a command-line extension for good. Restart it with DevTools `Extensions.loadUnpacked`. |
| "Receiving end does not exist" when messaging a tab | No page script there. Hold settings syncs inject it where hold-key drag should run; other pages get it on demand. |
| Capture never finishes on a page with a slow or lazy frame | `executeScript` with `allFrames` waits for every frame unless `injectImmediately` is set. |
| A Playwright suite hangs waiting for `filechooser` after a key press | Playwright turns chooser interception on only while something listens, and a key press can win the race. Keep a standing `page.on('filechooser', () => {})`. |
| Undo for a lookup says the details changed | Chrome's storage returns objects with their keys sorted at every depth. Compare with `sameCitation`, never by JSON text. |
| *Capture this page* is denied after the tab moves | Expected without all-sites access: the toolbar's temporary access ends on navigation. |
| Removing `http://*/*` also removed a single-site grant | Chrome does this. The product follows what Chrome still grants. |
| A visible drag check selects the wrong links | The real pointer was over the test window. Park it and rerun. |
