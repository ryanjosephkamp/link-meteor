# Working on Link Meteor

Instructions for coding agents and people working in this repository. Link Meteor is a Chrome Manifest V3 extension that captures links with their anchor text, organizes local collections and exports them. It has no server, no account, no telemetry, and no package dependencies. The static website lives in `site/`.

## Code map

| Path | What it holds |
| --- | --- |
| `src/manifest.json` | Version, permissions (optional ones are requested at runtime), minimum Chrome version. |
| `src/background.js` | The service worker's entry point: messages, context menus, the command, install and startup. |
| `src/background/` | Service worker areas: `store.js` (the one serialized queue for saved state), `hold.js` (hold-key drag, script registration, all-sites access), `card.js` (the on-page capture card's actions), `open.js` (opening up to 500 links), `theme.js` (the toolbar icon), `diagnostics.js` (Copy diagnostics), `bookmarks.js`, `backup.js`, `urls.js`. |
| `src/content/capture.js` | The page script: region selection, hold-key drag and the capture card, in a shadow root. It is injected on demand and registered on sites where hold-key drag runs. |
| `src/core/` | Pure modules with no Chrome or DOM access: `model.js` (state, reducer, migration, backup format), `export.js` (every export format, file names and rich links), `xlsx.js` (the workbook writer), `themes.js` (every theme's tokens and card colors). |
| `src/ui/workbench.*`, `src/ui/workbench/` | The side panel and full view: one page in two widths, split into area modules. |
| `scripts/` | `build.mjs` (copies `src/` to `dist/`), `package.mjs` (deterministic ZIP and receipt), `verify-package.mjs`, `sync-site.mjs`, `release-files.mjs` (the allowlist), `check.mjs`. |
| `tests/` | `*.test.mjs` unit tests (Node's test runner), browser suites (`*.mjs`), `helpers/browser.mjs` (Playwright launch, fixture server, build fingerprints), `helpers/action.mjs` (Chrome over a DevTools pipe, for the toolbar action), `debug-session.mjs`, and `fixtures/`. |
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
| unit (`tests/*.test.mjs`) | Model, migration, backup format, exports, opening limits, storage and races. |
| `access-browser` | Welcome card, Site access, opening tiers, the capture card through Chrome's real toolbar action, restart in place. |
| `capture-page-access` | *Capture this page* after the tab moves to a new site. |
| `access-content` | The page script with a stubbed `chrome` object (a simulation, with real input events). |
| `exports-browser`, `backup-browser` | Export names and workbooks; backup, restore, Undo and removing all. |
| `audit-overlay`, `audit-actions`, `audit-regressions` | Earlier fixes stay fixed. |
| `visual-browser` | Widths from 320 px, labels, focus, measured contrast, screenshots. Needs `LINK_METEOR_SEED_JSON`; `check` supplies one. |
| `site-check`, `sync-site --check` | The website, and its match with the packaged build. |

**Need a person's Allow clicks** on Chrome's native prompts, never run in CI:
1. First prepare grants in a new profile with `LINK_METEOR_TEST_PROFILE=<new-name> node tests/prepare-grants.mjs`. Add `LINK_METEOR_GRANTS=all-sites` for the all-sites profile. The owner, or computer use at the owner's direction, clicks Allow.
2. Then run `browser`, `extended-browser`, `site-browser`, `audit-granted-regressions`, `verify-downloads.py` and `access-granted` in those profiles.
3. Run `permission-browser` last, because it removes grants.

Visible runs need the real mouse pointer parked away from the test windows: ask before starting one.

## Test settings

| Variable | Meaning |
| --- | --- |
| `LINK_METEOR_EVIDENCE_DIR` | Where suites write results (default `artifacts/evidence`). |
| `LINK_METEOR_TEST_PROFILE`, `LINK_METEOR_VISUAL_PROFILE` | Profile name under `.scratch/`. |
| `LINK_METEOR_FIXTURE_PORT` | The local fixture server's port (default `52478`). |
| `LINK_METEOR_EXTENSION_PATH` | Load another unpacked build instead of `dist/`. |
| `LINK_METEOR_CHROME_PATH` | Run on another Chrome for Testing build, such as the oldest supported one; adds `--headless=new`. |
| `LINK_METEOR_PLAYWRIGHT`, `LINK_METEOR_PYTHON` | Where Playwright and Python are. |
| `LINK_METEOR_SEED_JSON` | The export the visual suite shows. |
| `LINK_METEOR_GRANTS`, `LINK_METEOR_HEADED` | Grant preparation and visible runs. |

## Rules

- **Profiles.** Use task-owned profiles under `.scratch/` only. Never use a personal Chrome profile, its collections, or an installed copy in `artifacts/link-meteor-*/` (those folders belong to the owner). A profile belongs to one build: the harness refuses a profile whose build changed, so use a new name.
- **Permissions are real.** Never forge grants, edit Chrome's permission files, or treat headless grants as proof of a native prompt. Every permission needs a reason in the UI, `docs/PRIVACY.md`, `site/privacy.html` and `CHROMEWEBSTORE.md` before it ships. Optional access is asked for only through an explained choice, never at install.
- **Privacy.** Extension pages keep `connect-src 'none'`. A feature that contacts any site must be opt-in and state what it sends where. No telemetry.
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
| *Capture this page* is denied after the tab moves | Expected without all-sites access: the toolbar's temporary access ends on navigation. |
| Removing `http://*/*` also removed a single-site grant | Chrome does this. The product follows what Chrome still grants. |
| A visible drag check selects the wrong links | The real pointer was over the test window. Park it and rerun. |
