# Iteration 01 ledger

- Start: 2026-09-25T17:39:09Z (13:39:09 EDT).
- Closeout planning: 23:09:09Z; approximate natural-stop window: 23:39:09Z.
- Driver selected by user: GPT-6 Astra Xhigh. Worker model/effort recorded from dispatch receipts below.
- Approved spec: docs/alignment/2026-09-25/ALIGNMENT.md; plan: docs/IMPLEMENTATION.md.
- Baseline remote main: 9efb43350a0115c15b059b428f7cc8bffcbd59b1; only README.md. Existing local alignment preserved.
- Local filesystem baseline: 316 KiB; available disk ~18 GiB. Existing Node 25.2.1, Python 3.12.1 and Playwright Chromium available. No dependencies downloaded.
- Sandbox network failed DNS; an authorized escalation for exact-repository bootstrap was accepted. No automatic approval rejection occurred.

## Decisions and scope

- Use lightweight packaged native JS/HTML/CSS, pure exports, and installed test tools to reduce dependencies/disk use.
- Follow the user's explicit worker method over generic skill defaults: Astra may build/fix/review, workers may be reused, no mandatory extra approval exchange, no nested workers, no deletion of historical evidence.
- Same-origin frames and open shadow roots are capture targets. Inaccessible frames are disclosed. Cross-origin frame extraction is not claimed without verified support.
- No runtime destination fetches, external assets, telemetry, or remote executable code.

## Progress

- Plan and contract self-review complete; cross-task consistency table in IMPLEMENTATION.md.
- Repository bootstrap complete on dedicated branch codex/chrome-v1; alignment preserved.
- No product tests have executed yet.

## Worker receipts

- 2026-09-25: `core_exports` => `/root/core_exports`, model `gpt-6-sol`, effort `high`, fork `none`, dispatch accepted. Owns only core model/export modules, their Node tests, and docs/worker-core.md. No nested delegation, Git writes, installations, or browsers. Astra concurrently owns capture/background and shared scaffolding.

## Integration checkpoint — 2026-09-25T18:20Z

- Initial planning push was rejected by GitHub GH007 (private author email). Preserved the rejected local commit `313e362` on `codex/iteration-01-private-email-checkpoint`; verified authenticated public GitHub ID 192532973; used the matching GitHub no-reply email in this repository only. Recreated author metadata with the original commit retained, without remote rewrite. Planning checkpoint `123da8f7cd5155924a180c6ef4fafa16fdc16adc` pushed and verified on `origin/codex/chrome-v1`. No account/security setting changed.
- Second worker `/root/workbench` dispatched as `gpt-6-sol`, effort `high`, fork `none`, after the core contracts settled. Ownership src/ui/* and worker UI notes; no nested workers or Git writes. Both actual dispatches accepted the requested model/effort. Subsequent bounded follow-ups reused these identities.
- Core worker delivered pure model/exports and 11 passing tests, later packaging and independent workbook reader. UI worker delivered workbench, then pagination/session reports/target refresh/lazy group detail repairs. Astra read source, integrated, and independently ran the core tests and workbook reader.
- Astra implemented background, content selector, manifest/assets/build, local fixtures and browser suite. Loaded extension checks have passed exact 37-link extraction, duplicates and empty-label fidelity, same-origin frame/open shadow capture, coverage warning, current-page targeting, Escape, 5-link pointer drag, wrapped one-pixel overlap, nested scrolling, dynamic links, notes/tags, filters/dedup/removal/undo, all seven downloaded formats, ordered columns and an actual clipboard paste. Full integrated acceptance remains in progress; failures are being repaired rather than waived.
- Native Chrome for Testing permission sheet was granted only for the synthetic 127.0.0.1 fixture in `.scratch/interactive`. Regular installed Chrome and other operating systems remain unverified. Initial headless optional-permission attempt did not pass; acceptance uses a headed dedicated test profile.
- Static capture/background review identified revoked-hold-state, discarded context reports, session bookkeeping and concurrent registration defects. Astra repaired these and added explicit simulated Chrome-API adverse-path tests; 6 tests passed. These simulations do not establish native permission revocation behavior.
- Identified Node process 20104 (`node tests/interactive.mjs`) was safely stopped with SIGTERM after its stdin was unavailable; its handler closed only its owned browser and fixture server. No broad process termination was used. Later suites close their own resources in finally blocks.
- Project footprint measured ~19 MiB, including ~18 MiB in ignored test profiles/cache; no dependencies or browsers downloaded.

## Further acceptance — 2026-09-25T18:25Z

- Checkpoint `17b9186a93dc0d626f86069271cac1ada6724e2f` committed/pushed; `git ls-remote` matched exactly. This is an implementation checkpoint, not final acceptance.
- A reused test profile retained an old background implementation after source changes. A runtime.reload experiment did not restore a usable extension page in that profile. Preserved that profile, created `.scratch/verified`, and verified the current background behavior there. Fixture server now uses a stable task-owned port (52478; configurable and fails if occupied) so per-origin permission setup remains repeatable. No browser security setting or installed user profile was altered.
- Native CUA checks in the dedicated Chrome for Testing profile: Option+Shift+L armed the selector, Escape removed it; extension toolbar action opened the actual side panel; bookmark permission sheet was accepted and UI reported 35 saved/2 non-web skipped; native page context-menu capture appended 37 and opened a report with the inaccessible-frame warning. Actual ordinary installed Google Chrome remains untested.
- Current build browser checks additionally passed mixed success/zero/denied/restricted/closed-tab batch reporting, persisted capture report, two normal windows with window/all scopes, configured hold key and editable-field exclusion, and exact saved-state equality after full browser/worker restart.
- Extended actual-browser checks captured 5,037 occurrences, rendered only 100 top-level rows, exported all 5,037, checked pagination selection, verified bookmark contents, opened one exact local URL after confirmation, and rejected a >20-link opening batch. One observed large capture took 661 ms; this is one synthetic run, not a performance guarantee.
- Narrow test found one CSS pixel of document overflow at 390 px; worker added shrinkable grid/control sizing and wrapped paging. Retest pending. Lazy duplicate-detail test needed an asynchronous toggle wait, now corrected.

## Final functional acceptance — 2026-09-25T18:37Z

- Final source review found three additional edge paths. Repaired recipientless mailto consistency with explicit malformed-destination exclusion counts; froze multi-tab scope before permission prompts; made Review-open failure a warning after a successful regional save. Core/browser regressions cover the mail case; explicit API simulations cover tab-opening failure; scope-race simulations are being retained as repeatable tests.
- Full loaded-extension suite passed 27 checks on a fresh fingerprinted `.scratch/acceptance-final` build: real pointer/one-pixel/page and nested scrolling/same-origin frame selection, regional copy feedback, exact labels and provenance, malformed destinations, all seven downloads, actual clipboard paste, scopes and partial failure, hold configuration, persistence and responsive bounds.
- Extended suite passed 8 checks: 5,037 DOM links (one final observation 577 ms), 100-row pagination, all-row export, real bookmark contents, bounded opening, lazy 100-occurrence details, and per-link draft/save behavior.
- Independent openpyxl parse of the actual downloaded workbook matched all 53 anchor/URL pairs exactly, with every XLSX cell typed as a string. The separate escaping fixture also passed ZIP/XML/openpyxl checks. Microsoft Excel itself is untested.
- Actual permission revocation checks passed: settings pruned, registered scripts removed, already-loaded hold gesture disabled, subsequent capture denied. A native Deny-button test remains unverified because automated re-requests were granted in this testing environment. Native Allow sheets, native shortcut, side panel, and context-menu checks remain separate observed evidence.
- Runtime reload experiments were abandoned after bounded failures. The harness now fingerprints packaged bytes and refuses reuse after changes; new profiles are used for changed builds. Earlier profiles were retained, not removed. No future/background iteration is scheduled.
- Final visual-only change improves dark destructive-text contrast. Fresh headless presentation checks cover 320/390/412/1440px and measured contrast. The functional JS is unchanged from the passing integration suites.
