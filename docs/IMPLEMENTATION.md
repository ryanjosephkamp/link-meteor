# Link Meteor Chrome v1 Implementation Plan

> **For agentic workers:** Use the subagent-driven-development workflow with the user's explicit overrides: Astra reviews and may implement/repair directly, workers can be reused, no nested delegation, maximum two concurrent workers, and no further routine plan approval. Preserve this plan and all evidence.

**Goal:** Deliver a working, locally processed Chrome extension covering the approved first-release scope, with reproducible evidence and a review/Opus handoff.

**Architecture:** A Manifest V3 extension uses a self-contained injected capture script, a background module as the sole storage writer, pure model/export modules, and a shared side-panel/full-tab workbench. Browser messaging is an explicit boundary. No server, runtime network dependency, telemetry, or destination enrichment.

**Tech stack:** Native JavaScript ES modules with JSDoc contracts, semantic HTML/CSS, Chrome MV3 APIs, Node's built-in test runner, and the already installed Playwright Chromium for browser integration. XLSX is generated as an OOXML ZIP with string cells, verified using an independent reader. No product package installation is initially required.

**Spec:** `docs/alignment/2026-09-25/ALIGNMENT.md` (approved by the user September 25, 2026).

## Global constraints

- Project only: `/Users/noir/Documents/link-meteor`; GitHub only `ryanjosephkamp/link-meteor`.
- No deletion outside this directory, unrelated process termination, global installations, account changes, deployment, payment, Opus launch, or future automation.
- Start 2026-09-25T17:39:09Z; closeout planning 23:09:09Z; approximate iteration end 23:39:09Z. Finish earlier when ready.
- Astra owns Git, background/capture integration, acceptance, and handback. Workers write only their owned files, do not commit/push or delegate, and report executed checks accurately.
- Preserve occurrence provenance and separate anchor text from URLs. No fabricated titles. Browser restrictions and partial failures must be visible.
- Maximum two workers and one task-owned browser instance by default. Reuse installed runtimes; isolate configurable temporary files beneath `.scratch/`.
- Defer Firefox, Safari, AI, crawling, automatic pagination, PDF-content extraction, and the GitHub Pages site.

## Review focus

1. Wrapped anchors, page/nested scroll, cancellation, and selections overlapping a link by only one pixel must produce predictable results (Task 2 browser fixtures).
2. Simultaneous tabs/side panel updates and service-worker restarts must not overwrite or lose a saved collection (Tasks 1/3/5).
3. Identical URLs with different labels/source pages must remain distinct occurrences even when a deduplicated view is exported (Tasks 1/4/5).
4. Denied host permissions, browser pages, navigated/closed tabs, and inaccessible frames must not look like successful zero-result scans (Tasks 3/5).
5. User-controlled labels containing formulas, quotes, HTML, Unicode, and line breaks must survive safe exports and display without script execution (Tasks 1/4/5).

## Shared contracts

See `docs/CONTRACTS.md` for the exact shapes and APIs. All workers read it before editing. UI imports only `core/model.js` and `core/export.js`; storage is accessed through background messages. Content candidates are untrusted; the background/model validates them before storage. All mutating background requests are serialized through a promise queue and write before replying.

## Task 1 — Core model and export adapters (first Sol worker)

Files: `src/core/model.js`, `src/core/export.js`, `src/core/xlsx.js`, `tests/core.test.mjs`, `tests/export.test.mjs`.

- [x] Write tests for empty state/collection operations, immutable append/remove/undo, faithful labels and occurrences, filter/dedup behavior, and independent source preservation.
- [x] Run `node --test tests/core.test.mjs` and establish an initial failing result before implementation.
- [x] Implement the pure APIs in CONTRACTS.md with validation and non-destructive views.
- [x] Write export tests using strings such as `=1+1`, `a,"b"\n雪`, `<img onerror=alert(1)>`, an empty label, and duplicate URLs from different sources; assert safe output and original data immutability.
- [x] Implement CSV/TSV/text/Markdown/HTML/JSON/XLSX with configurable column order. Example acceptance: `makeExport([row], {format:'csv',columns:['anchorText','url']}).data` must contain both headers in that order and quoted distinct cells.
- [x] Run `node --test tests/core.test.mjs tests/export.test.mjs`; hand back files, output, and limits. Astra reviews and commits this milestone.

## Task 2 — Capture engine and selection overlay (Astra)

Files: `src/content/capture.js`, `tests/fixtures/index.html`, `tests/fixtures/frame.html`, capture cases in `tests/browser.mjs`.

- [x] Create deterministic fixtures with expected text/URL pairs, image links, hidden text, repeated targets, open shadow roots, same-origin frames, external frames, dynamic anchors, nested scroll, wrapped text, and a large generated list.
- [x] Implement loaded-page extraction and a geometry-driven overlay. A link counts when any visible clipped client rectangle has positive-area intersection with the selection. Ignore hidden content, unsupported schemes, and extension-owned UI. Traverse open shadow roots and accessible same-origin frames; report inaccessible frames.
- [x] Implement shortcut arming, Escape cleanup, live highlights/count, page and nested-container scrolling, additional capture batches, a compact action strip, and explicit success/failure feedback.
- [x] Test by real pointer drags in the loaded extension; assert exact fixture IDs/labels and no accidental navigation after cancellation/selection. Add scroll and partial-intersection cases.
- [x] Implement optional hold-key mode with editable key, editable-field exclusion, per-origin permission, and graceful disabling. Astra reviews and checkpoints the slice.

## Task 3 — Manifest, background coordination, persistence and browser actions (Astra)

Files: `src/manifest.json`, `src/background.js`, `src/icons/*`, `scripts/build.mjs`, `package.json`.

- [x] Build a loadable MV3 package with action/side panel, configurable command, context menu, required current-page/scripting/storage/clipboard APIs, optional tabs/bookmarks and HTTP(S) hosts. Bundle only product files.
- [x] Implement the background message API, serial state mutation, current-target selection, and safe capture orchestration. Preserve state on storage failure and return actionable errors.
- [x] Capture each selected tab independently and return a report: success, denied, unsupported, closed/navigation error, plus covered/omitted frames and counts.
- [x] Implement optional hold-mode dynamic content registration for approved origins, removal on disable/revocation, and restart reconciliation.
- [x] Implement explicit bookmark-folder creation and sequential, bounded opening of HTTP(S) links (at most 20 per confirmed action); report failures without pretending atomicity.
- [x] Test the complete current-page path and state persistence across background/browser restart; test multi-tab/window scope, denied hosts, and restricted pages before milestone commit/push.

## Task 4 — Workbench UI (second independent Sol worker after contracts settle)

Files: `src/ui/*`, UI cases in a worker-owned `tests/ui.test.mjs` if useful. Do not edit core/background/capture files.

- [x] Implement semantic side-panel and full-tab UI using the same page, original meteor styling, system fonts, accessible focus, light/dark theme, and reduced motion.
- [x] Connect the exact background APIs; display collections, rename/notes/tags, source provenance, all occurrences and dedup counts, filters, sorting, selection, remove/undo, and empty/loading/error feedback.
- [x] Add source-scope preview, selected-tab picker and runtime permissions from explicit gestures; selection activation and settings; open full view.
- [x] Add ordered export-column controls; download each supported format; clipboard choices; explicit bookmark permission; bounded open confirmation. Derive export targets consistently: selected groups if selection exists, otherwise the visible filtered view; disclose representative/dedup mode.
- [x] Test UI interactions in the real loaded extension and inspect narrow side-panel and desktop states. Astra audits escaping and failure feedback, then commits/pushes integrated work.

## Task 5 — Independent integration acceptance and repair (Astra, with bounded worker fixes)

Files: `tests/browser.mjs`, `tests/verify-xlsx.py`, `docs/ACCEPTANCE.md`, concise `artifacts/evidence/*`.

- [x] Run all Node tests and package validation. Inspect generated XLSX with an independent Python reader available on the host (no download solely for this check).
- [x] Run the extension in a dedicated persistent Chromium profile served by a task-owned local HTTP fixture server. Record only task-owned server/browser identities and close them explicitly.
- [x] Exercise capture, append/review/export, filters/selection/dedup, persistence, scopes/permissions, and export injection cases. Read the actual downloaded outputs.
- [x] Inspect screenshots of the full workbench, narrow side panel, selection, and meaningful errors. Check keyboard paths, responsive overflow, and semantic control labels.
- [x] Perform visible native shortcut checks in installed Chrome for Testing where the supported tools allow; distinguish these from injected-message or Chromium automation evidence. Report any untested native behavior.
- [x] Fix material findings or assign one bounded repair at a time; rerun covering checks and the integrated suite when changes cross boundaries. Review final diff against the acceptance map.

## Task 6 — Review build and Opus handoff (Astra)

Files: `README.md`, `docs/PRIVACY.md`, `docs/handbacks/iteration-01/*`, `docs/opus-handoff/*`, `artifacts/releases/*`.

- [x] Create a development ZIP and verify its file manifest and hash. Record exact source/build identity and installation instructions.
- [x] Produce the accepted feature/check/limitation map, resource/time notes, outstanding human acceptance, worker reconciliation, and verified GitHub checkpoint status.
- [x] Prepare separate Opus extension-refinement and website briefs with code context, screenshots, test evidence, known limitations, and a return-to-Astra prompt. Ask Opus to create its own scaffolding and choose its own approach without prescribing stack or governance.
- [x] Render the mobile HTML handback with the report skill, canonical Markdown, exact next prompt, embedded relevant screenshots, and no clipboard troubleshooting. Validate source parity and narrow layout.
- [x] Reconcile all worker writes, stop task-owned background processes, checkpoint/push, verify remote head, and stop for the user's review. No publication or Opus execution.

## Preflight consistency review

| Pair/task | Shared boundary or check | Resolution |
| --- | --- | --- |
| 1/3 | Model operations and stored state | Exact reducer/state contract; background is sole storage writer. |
| 1/4 | Filter/dedup/export output | UI uses pure exported functions and preserves all occurrence IDs. |
| 2/3 | Capture candidate and report | Background validates/assigns identities; content owns geometry only. |
| 3/4 | Browser messages, permissions | Discriminated messages and explicit `{ok,data,error}` envelope; permissions requested by UI gestures. |
| 2/5 | Selection expected results | Real pointer fixtures, not only simulated messages. |
| 1–4/5 | Integrated acceptance | Tests inspect stored occurrences and export bytes in the loaded extension. |
| 5/6 | Acceptance versus handback | Unexecuted native/human checks stay explicitly unverified. |
| 1 | Core scope | Pure modules and tests only; no storage/global Chrome dependency. |
| 2 | Capture scope | Same-origin frames/open shadow supported; other coverage explicitly limited. |
| 3 | Coordination scope | Serialized persistence, distinct errors, restricted actions. |
| 4 | UI scope | Disjoint ownership; no hidden storage writes or remote assets. |
| 5 | Test scope | Real browser claims separated from mock/unit evidence. |
| 6 | Handoff scope | No site implementation, deployment, store submission, or Claude launch. |

## Closeout acceptance qualification

Implementation tasks are complete for the development baseline. The acceptance map in docs/ACCEPTANCE.md is authoritative for executed versus simulated versus remaining human checks. Native checks used Chrome for Testing; ordinary installed Google Chrome remains unverified. Store publication, site implementation, Firefox/Safari, Opus execution and human approval have not occurred. Delivery artifacts and final remote verification are recorded in the iteration handback.
