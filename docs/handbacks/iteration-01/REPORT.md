# Link Meteor — first Chrome baseline

**Ready for your manual review and the planned Opus design pass.** Version 0.1.0 implements the accepted first-release scope. The integrated checks passed, and the tested product source is backed up on GitHub. Nothing has been submitted to the Chrome Web Store or deployed as a website.

## What you can use

Select a region with a shortcut and drag, see matching links, and add them to a local collection. Capture the current page, selected tabs, a window, or all ordinary windows in the current Chrome profile. Optional hold-key mode runs only on permitted sites.

The side panel and full-page workbench keep anchor text and URLs separate, with source provenance, notes and tags. You can filter, sort, group duplicates reversibly, remove/undo, and export Excel .xlsx, CSV, clipboard columns, Markdown, HTML, JSON or bookmarks. Link opening is bounded and permission/empty/partial-failure states are explicit.

Everything is local and free: no account, ads, telemetry, paid tier or backend dependency. Textless anchors stay empty; accessible labels are separate. Duplicate occurrences retain their original labels and sources. Original branding and presentation were created for this build. Name/IP clearance has not been established.

## Implemented screens

These images show the working extension with synthetic research fixtures, not design mockups. The narrow image demonstrates responsive layout; it is not evidence of a mobile browser extension or Android acceptance.

### Region selection

{{MEDIA:region}}

### Review and exports

{{MEDIA:review}}

### Narrow workbench

{{MEDIA:narrow}}

### Dark presentation

{{MEDIA:dark}}

## Checks and what they establish

| Evidence | Result | Practical limit |
| --- | --- | --- |
| Node tests | 23 passed, zero failed | Includes explicitly simulated Chrome failure and permission-race paths. |
| Loaded-extension workflows | 27 passed | Actual headed Chrome for Testing: drag geometry/scrolling, labels, scopes, downloads, clipboard paste, restart persistence and partial failures. |
| Large collection and actions | 8 passed | 5,037 actual loaded links, 100 rendered rows, complete export, lazy detail, bookmark contents and bounded opening. |
| Real site-permission revocation | 3 passed | Registered/loaded hold behavior stops and later capture is denied. Native Deny-button acceptance is still missing. |
| Presentation checks | Passed at 320/390/412/1440 CSS px | No document overflow; focus and visible control labels; dark destructive-text contrast 8.99:1. Not a full accessibility audit. |
| Independent workbook reader | Passed | Actual downloaded workbook matches 53 exact anchor/URL pairs; all cells are strings. Separate escaping fixture passed ZIP/XML/openpyxl checks. Excel itself remains untested. |
| Packaged artifact | Passed | Exact 13-file allowlist, CRCs, per-file hashes and archive hash independently verified. |

Through native computer use in the installed **Chrome for Testing**, Astra also observed Option+Shift+L, Escape, the real toolbar side panel, page context menu, and site/bookmark permission Allow sheets. These observations are distinct from the automated checks. The user's everyday Google Chrome was not used.

Two workers delivered implementation and static-review evidence. Astra read and reconciled their changes, repaired integration issues, and ran the integrated acceptance checks. Worker reports alone were not treated as acceptance. The final small dark-color CSS adjustment was checked separately; functional JavaScript remained unchanged from the passing full suites.

The evidence map is [ACCEPTANCE.md](../../ACCEPTANCE.md). JSON receipts, actual exported files and full screenshots are in [artifacts/evidence](../../../artifacts/evidence/). Reproducible commands and isolated-profile setup are in [README.md](../../../README.md).

## What still needs your review

- Load the development build in ordinary Chrome and try two or three research/admin pages you use.
- Try your preferred shortcut and optional hold gesture; inspect one spreadsheet in Excel.
- Try the native permission Deny button. The automated environment granted repeat requests, so native denial was not established.
- Judge the interaction design, narrow panel and source-review flow. Screen-reader use and a complete accessibility audit remain open.

Coverage is intentionally honest: inaccessible cross-origin frames, closed shadow roots, unloaded virtualized items, opaque JavaScript-only controls and PDF contents are not promised. Loaded same-origin frames and open shadow roots were checked. Minimum Chrome 116 is declared but not tested at that version; other operating systems and Firefox/Safari are unverified. Version one has no import/restore flow.

Operational limits are visible: 20,000 links scanned per page/region, 100 tabs per batch, 20 links opened per action, and Chrome's local-storage quota. Successful partial results are retained. The final synthetic 5,037-link capture took 577 ms once; this is an observation, not a general performance claim. Peak RAM was not measured.

## Try the development build

1. Download and extract [link-meteor-0.1.0.zip](../../../artifacts/link-meteor-0.1.0.zip). It is a development artifact, not a Store installer.
2. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. Alternatively build the repository with `npm run build` and select its `dist` folder.
3. Pin Link Meteor, visit an ordinary webpage, and open its side panel. Configure the shortcut in `chrome://extensions/shortcuts` if needed. On this Mac, the native Option+Shift+L activation was observed working.
4. Capture a region or page, inspect the separate anchor/URL columns, add notes/tags, and export. Site/bookmark permissions are requested when the corresponding feature needs them.

Collection storage is local to this extension/profile. Chrome may separately synchronize bookmarks according to your browser settings. Export anything you want to retain before uninstalling. [Privacy and permissions](../../PRIVACY.md) describes the current behavior.

## Source and backup

- Repository: [ryanjosephkamp/link-meteor](https://github.com/ryanjosephkamp/link-meteor).
- Branch: `codex/chrome-v1`; remote main was left at `9efb43350a0115c15b059b428f7cc8bffcbd59b1`.
- Tested source: `a6dddac13b14307e6a343e78d540167c1232dc4b`, committed, pushed and verified by exact remote hash match.
- Earlier coherent checkpoints `123da8f` and `17b9186` were also pushed and verified. This report and its artifacts are delivered in a subsequent documentation/artifact commit; the final task reply records that verified delivery commit.
- Development ZIP: 116,560 bytes / 13 files. SHA-256: `60ffd66c561863172bb09e685ec698c1cf889abb62c3027eca13cf0bc3075f85`.
- [Packaging receipt](../../../artifacts/link-meteor-0.1.0.sha256.json) confirms clean product source. Its overall working-tree flag is true because artifacts/evidence were untracked at packaging time.

The first planning push hit GitHub's private-author-email protection. The rejected local commit was preserved on a separate local branch; subsequent commits use the verified GitHub no-reply address configured only in this repository. No account/security setting or remote history was changed, and no force push was used.

## Autonomous iteration and resources

The timer began September 25, 2026 at **17:39:09 UTC / 1:39:09 p.m. EDT**. This report was assembled after about 67 minutes; the final reply states total elapsed time including report validation and remote backup. The iteration finished well before its approximate six-hour limit; no new iteration or background schedule was created.

Actual worker dispatches were `/root/core_exports` and `/root/workbench`, both **gpt-6-sol / high / fork none**, reused for bounded follow-ups. One worker started first; the second joined after interfaces settled with disjoint ownership. There were no nested workers. Both completed and returned before handback. Astra owned architecture, capture/background integration, independent review and acceptance.

Existing Node, Python, Playwright and Chrome for Testing were reused. No dependency/browser downloads, global installs, VMs or containers were needed. After report validation and packaging, the project used about 100 MB, with 94 MB in ignored task-owned profiles/cache and 3.1 MB in artifacts. No RAM or billing savings are claimed.

Task-owned test browsers and servers were closed. Process/port checks found no remaining task-profile process or listener on fixture port 52478. No unrelated session, app, browser or server was terminated. Old task profiles and historical evidence remain recoverable under the project.

A reused unpacked browser profile cached old background code during development. Bounded reload experiments were inconclusive; acceptance moved to fresh profiles. Tests now fingerprint packaged bytes and reject changed-build profile reuse. This prevents an old extension from being mistaken for the current source.

## Opus package and your next step

Review this baseline, then give the embedded prompt to **Claude Opus 5.5 in Claude Code** when you are ready. The [portable handoff ZIP](../../../artifacts/link-meteor-opus-handoff.zip) contains source, the development build, evidence, reports and prompts. The [orientation](../../opus-handoff/README.md), [extension brief](../../opus-handoff/EXTENSION-BRIEF.md) and [site brief](../../opus-handoff/SITE-BRIEF.md) are also available in the repository.

Opus is asked to inspect the project and create its own scaffolding, with freedom over design, technology, workflow and internal organization. The package preserves required product behavior and boundaries without prescribing its design process. The [return-to-Astra prompt](../../opus-handoff/RETURN_TO_ASTRA.txt) requests the final functionality audit after you bring the result back.

No Pages site, Firefox/Safari port, AI feature, Claude session, Store publication or deployment was started in this iteration. The only next action is your review; no further autonomous work is scheduled.

The exact Opus prompt is embedded below and remains fully readable without JavaScript. Mobile-preview Copy is assumed unavailable and was not investigated. Physical Android preview and clipboard behavior are untested. The HTML embeds its screenshots and needs no remote assets; companion file links work when the package/repository structure is available.
