# Link Meteor: Opus 5.5 design pass, return summary

Date: September 25, 2026. Author: Claude Opus 5.5 in Claude Code. Status: ready for the user's review and GPT-6 Astra's final functionality audit. Nothing was deployed or published.

## Identity

- Repository: https://github.com/ryanjosephkamp/link-meteor, branch **`claude/design-v1`**, created from `codex/chrome-v1` at `499c3ab` (which carries the tested baseline `a6dddac`). `codex/chrome-v1` and `main` were not modified.
- Tested product source: commit **`7c9ca4a`**. Documentation, site and evidence follow in later commits on the same branch; the branch head is the final state.
- Build: `artifacts/link-meteor-0.2.0.zip`, 191,513 bytes, SHA-256 `1cb1b778a91180709455e273eb9b0f1cbefe758a6e43d01156729c14330fc197`, `sourceFilesGitDirty: false`. The 0.1.0 baseline ZIP is kept alongside for comparison. The same ZIP is copied to `site/downloads/` for the install page.

## What changed in the extension

**Design.** A new identity: a meteor mark (bright head, tapering trail), night ink plus fireball lime, cool neutrals instead of cream, one hand-drawn icon set, system fonts at a tight product scale. `docs/PRODUCT.md` and `docs/DESIGN.md` record the intent and the system.

- **Overlay:** a consistent ink card that reads the same on light and dark sites. Lime highlighter marks and a lime-edged rectangle, the destination collection named on the card, the first three captured labels previewed, and an "Added" state after saving.
- **Side panel:** compact views for links, for collections and site settings, and for export, plus a bottom dock with the exact target ("All 18 links", "3 selected") and quick "Copy text + URL".
- **Full tab:** three columns (collections rail, links, export), with anchor text, URL and source as real columns.
- **Rows:** exact URLs with the host emphasized; empty anchors labeled "No anchor text" beside the accessible label; file-type, email/phone and ×N badges; "Also labeled …" and "and N other pages" in grouped views; a chevron opens full provenance and per-occurrence notes.

**Behavior changes (all within the accepted scope):**

- Capture scope is a segmented control, and the button states the exact action ("Capture 3 tabs"). The tab picker is grouped by window, with Select all / Clear and a "Can't capture" flag. The preview says when Chrome will ask for site access, computed with `permissions.contains`; no new permission.
- Search, filters, sort and group live behind **View**, with removable chips for active options. Domain and file-type inputs suggest values from the collection. A no-match state offers "Clear search and filters".
- The capture report explains each status in plain words, keeps Chrome's raw message, and offers **Show only these links**, a view filter by batch ID.
- Rows from the latest capture briefly highlight on arrival, including captures made from the overlay while the panel is open.
- **Select all N** appears when a whole page is selected in a multi-page view.
- The collection editor is a disclosure (pencil button). Delete and Open-in-tabs use **inline confirmations instead of `window.confirm`**; Open still rejects more than 20 before any tab opens.
- Notices are toasts: removal offers Undo, and errors persist until dismissed.
- Keyboard: `/` focuses search; Esc closes confirmations and compact views.
- The shortcut shown in the UI is read from `chrome.commands.getAll()`, so an unassigned shortcut shows "Not set".
- **Open full view** is hidden when the workbench is already in a tab.
- Each occurrence's details include a Copy URL action.
- New background message: **`collection.active`** returns `{name, count}`. It is read-only and allowed from content scripts, and is used by the overlay card.

**Unchanged:** capture geometry and scanning, scopes and limits, storage schema v1 and existing data, the reducer and query model, every export format and its safety rules, bookmark and open bounds, hold-key registration and revocation handling, permission declarations and request paths, CSP. `core/*` is byte-identical to `a6dddac`.

## The website (`site/`)

Static HTML/CSS/JS with no build step, no dependencies and no third-party requests. Atkinson Hyperlegible Next and Mono are self-hosted under the OFL; the user approved the font download.

- **Home:** an interactive capture demo (drag across a sample reading list, using the same positive-area rule), the "Two fields. Never merged." specimen, a scope ladder with permission notes, the real capture-report screenshot, the real workbench screenshot, a live export preview running the extension's own `export.js` (including a real `.xlsx` download), a privacy band, and plain limits.
- **Other pages:** install (with an honest tested-environment note and the ZIP SHA-256), a full guide, privacy (extension and website), and a practice page of synthetic links. Each practice section's answer key is verified with the real extension.
- **Deployment:** prepared, not performed. `.github/workflows/pages.yml` runs only on manual dispatch and first runs `sync-site.mjs --check`; `site/README.md` lists the steps.

## Checks actually run on the 0.2.0 build

See `docs/ACCEPTANCE.md` for details. In summary:

- `npm test` 23/23.
- Loaded extension in headed Chrome for Testing, fresh profile: `browser.mjs` 27/27, `extended-browser.mjs` 8/8, `site-browser.mjs` (8 answer keys plus field checks), `permission-browser.mjs` 3/3 (run last).
- `visual-browser.mjs` (headless): overflow, labels, focus, 22 contrast pairs ≥ 5.1.
- `verify-downloads.py`: 59 XLSX/CSV/JSON pairs exact. `verify-workbook.py`: pass.
- `site-check.mjs` (50 page layouts, links, structure, contrast ≥ 4.63, demo, exporter): pass. `sync-site.mjs --check`: pass.

Test edits changed interaction paths only (open the editor or View first, the inline confirmation, the selection wording, and a 2 s poll for the live badge). Assertions keep their meaning.

**Evidence labels:** these are automated Chromium results. Optional grants resolved as granted in automation without a click from me, and the mechanism wasn't established, so they are not native-prompt evidence. `tests/design-preview.mjs` and `tests/overlay-preview.mjs` are simulations for design iteration only.

## Known limitations and remaining manual checks

- Not yet verified: everyday Google Chrome; the native Allow/Deny sheets; the real side panel's width and resizing; Windows/Linux shortcuts; Microsoft Excel; screen readers; real research and admin sites; Chrome 116; the deployed site; phones and non-Chromium browsers.
- Coverage limits are unchanged: cross-origin frames, closed shadow roots, unloaded content, PDF contents, opaque script buttons, and operational limits of 20,000 links, 100 tabs, 20 opens and storage quota.
- Panel-width screenshots render the workbench in a tab, not inside Chrome's native side-panel frame.
- Name/IP clearance remains unestablished. No Chrome Web Store listing exists, and the site says so.

## Decisions for the user

1. **Dev ZIP on the site.** When deployed, `install.html` offers `downloads/link-meteor-0.2.0.zip` publicly. Keep it, or link only to the repository?
2. **Merge and deploy.** Whether and when to merge `claude/design-v1`, enable Pages ("GitHub Actions" source) and run the manual workflow.
3. **Native permission check.** Try the Allow and Deny sheets yourself in everyday Chrome, since automation doesn't establish them.
