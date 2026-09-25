# Link Meteor — Opus 5.5 handoff

Status: a functionally checked Chrome development baseline, ready for the user's review and your design work. This is not a Chrome Web Store release. The user will initiate Claude Code; no Claude session was launched by Codex.

## Identity and starting point

- Only project: `/Users/noir/Documents/link-meteor`.
- Only authorized repository: https://github.com/ryanjosephkamp/link-meteor.
- Implementation branch: `codex/chrome-v1`.
- Tested product source: `a6dddac13b14307e6a343e78d540167c1232dc4b`, pushed and independently matched against the remote branch on September 25, 2026. A subsequent documentation/artifact commit contains this handoff; inspect current Git state and preserve intervening work.
- Version: `0.1.0`. Development build: `artifacts/link-meteor-0.1.0.zip` (116,560 bytes, 13 files).
- Build SHA-256: `60ffd66c561863172bb09e685ec698c1cf889abb62c3027eca13cf0bc3075f85`. Per-file hashes and source identity: `artifacts/link-meteor-0.1.0.sha256.json`.
- Packaged product source was clean. The packaging receipt reports a dirty overall working tree because evidence/artifacts had not yet been committed; it does not imply uncommitted product code.

The portable `artifacts/link-meteor-opus-handoff.zip` includes the exact tested source snapshot, this handoff, the development ZIP, evidence, and the mobile handback. It omits Git internals, profiles, caches, dependencies, and scratch data. Its companion JSON records archive entries and hashes. When working in the existing project, inspect it rather than extracting a snapshot over newer work.

## Read in context

1. `docs/alignment/2026-09-25/ALIGNMENT.md` — approved user-facing scope and boundaries. Its planning-status paragraphs are historical; acceptance is now recorded separately.
2. `docs/CONTRACTS.md` — implemented data and component contracts.
3. `docs/ACCEPTANCE.md` — executed checks, qualifications, and remaining human acceptance.
4. `docs/PRIVACY.md` — local data and permission behavior.
5. `EXTENSION-BRIEF.md` and `SITE-BRIEF.md` — your two distinct deliverables.
6. `OPUS_PROMPT.txt` — the self-contained launch prompt; `RETURN_TO_ASTRA.txt` — the user's eventual audit prompt.

Inspect the project and create your own scaffolding before beginning. Choose your own planning structure, design process, internal workflow, tools, and technical approach. The existing code and Codex documents are context and evidence, not a required stack or governance template. Refactoring is welcome when it preserves the product contract and boundaries.

## Existing implementation context

The baseline uses packaged native JavaScript/HTML/CSS, Manifest V3, and no runtime dependencies. `src/content/capture.js` implements extraction and the region overlay; `src/background.js` coordinates browser actions and serialized persistence; `src/core/` contains the collection model and export adapters; `src/ui/` contains the side-panel/full-page workbench. Original icon assets live in `src/icons/`. `scripts/` builds and packages; `tests/fixtures/` is the deterministic local test site.

Node 22+ is sufficient for `npm run build`, `npm test`, and `npm run package`; no npm install is necessary for the baseline. Browser checks reuse an already installed Playwright runtime and Chrome for Testing. README explains isolated profiles and grants. A profile fingerprint deliberately rejects reuse after packaged bytes change: prepare a fresh task-owned profile for changed builds. Permission revocation tests run last. Never use a personal profile for automated destructive fixture setup.

## Evidence and its limits

Astra integrated and reviewed both Sol High workers' changes, then verified 23 Node tests, 27 loaded-extension workflow checks, 8 large-collection/action checks, and 3 actual site-permission revocation checks. Separate responsive/focus/label/contrast checks passed at 320, 390, 412, and 1440 CSS pixels. Actual downloaded XLSX strings were independently read with openpyxl; all 53 anchor/URL pairs matched JSON. The final CSS-only contrast adjustment received a separate visual check with unchanged functional JavaScript.

Native UI interactions in the installed Chrome for Testing included the shortcut, Escape, toolbar side panel, context menu, and permission Allow sheets. This is distinct from automated Chromium evidence and from the user's everyday Google Chrome. The native Deny button, Microsoft Excel itself, screen readers, real research sites, other operating systems, and Chrome 116 are not accepted by this evidence. Declaring a minimum version does not establish testing at that version.

`artifacts/evidence/` contains JSON receipts, actual synthetic exports, and implemented screenshots. `region-drag.png`, `workbench-review.png`, `workbench-narrow.png`, and `workbench-dark.png` are useful starting visuals. `browser-failure.png` and `workbench-initial.png` are historical diagnostic captures, not the final presentation. Worker reports are implementation/static-review records; they do not supersede driver acceptance.

No blocking defect was observed in the final executed suites. Known coverage limits remain: inaccessible cross-origin frames, closed shadow roots, unloaded virtualized items, opaque JavaScript controls, PDF contents, and untested site layouts. Version one has no import/restore flow. Limits of 20,000 scanned links per page/region, 100 tabs per batch, 20 opened URLs per action, and browser storage quota are operational and must remain visible, with partial results retained.

## Boundaries and return

Preserve faithful separate anchor text/URL fields, originals, provenance, permission meaning, and the free/local product promise. Do not copy the reference product's code, assets, branding, or presentation. Name/IP clearance remains unresolved; do not claim clearance.

Work only in this project/repository. Preserve existing work and unrelated processes/apps/sessions; do not delete outside the project or use destructive Git rewrites. Keep resource use modest. Do not alter credentials/account/security settings, publish to the Chrome Web Store, make payments, deploy the site, start ports/AI features, or schedule later runs without the user's further instruction.

Return the final source/commit, changed behavior and permissions, screenshots, checks actually run, known limitations, and a short explanation of design decisions. The user will return your result to Astra for a final functionality audit before publication is considered.
