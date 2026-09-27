# Evidence: 0.3.0 release candidate 2 (September 27, 2026)

Branch `codex/0.3.0-rc2`, based on `16590cb`. The extension source tested is commit `98f79af`. **FAIL / stopped before grants:** the new access-browser restart check failed at its wait twice. The two-attempt stop rule was applied; the lifecycle fix and remaining acceptance checks are unverified. No ZIP was packaged.

## Checks without optional grants

| Check | Result | Notes |
| --- | --- | --- |
| Build | Pass | [Output](logs/build.txt). 35 files, 364,147 bytes. |
| `npm test` | 93 pass, 1 expected skip | [Output](logs/node-tests.txt). No 0.3.0 ZIP exists. |
| `tests/access-browser.mjs` | FAIL, twice; 20 checks passed in each run | [Latest output](logs/access-browser.txt), [results](access-browser-results.json). The 19 existing checks and the new pre-restart region-selection check passed. Post-restart selection was not reached. |
| `tests/access-content.mjs` | Not run | Stopped before this suite. |
| `tests/exports-browser.mjs` | Not run | Stopped before this suite. |
| `tests/backup-browser.mjs` | Not run | Stopped before this suite. |
| `tests/capture-page-access.mjs` | Not run | Stopped before this suite. |
| `tests/audit-overlay.mjs`, `tests/audit-actions.mjs`, `tests/audit-regressions.mjs` | Not run | Stopped before these suites. |
| `tests/visual-browser.mjs` | Not run | Stopped before this suite. |
| `tests/site-check.mjs` | Not run | Stopped before this suite. |

## Allow clicks

None. Neither `r030-rc2-site` nor `r030-rc2-all` was prepared. No native Allow prompt was requested or clicked. No visible suite ran; pointer confirmation was not needed.

## Granted suites

| Check | Result | Notes |
| --- | --- | --- |
| `tests/browser.mjs` | Not run | Grants not prepared. |
| `tests/extended-browser.mjs` | Not run | Grants not prepared. |
| `tests/site-browser.mjs` | Not run | Grants not prepared. |
| `tests/audit-granted-regressions.mjs` | Not run | Grants not prepared. |
| `tests/verify-downloads.py` | Not run | Stopped before preceding download suites. |
| `tests/access-granted.mjs` | Not run | Restart regression and switch `check()` remain unverified. |
| `tests/permission-browser.mjs` | Not run | Grant-dependent expectations and per-site precondition remain unverified. |

## Failed runs and diagnostics

- [Run 1](diagnostics/access-browser-run1-restart-wait/): after scheduling `chrome.runtime.reload()` in the workbench, the test waited for a new extension service-worker target from `Target.getTargets`. It timed out. The existing action helper explicitly documents that this target list excludes extension workers, proving that wait was wrong.
- [Run 2](diagnostics/access-browser-run2-restart-wait/): the test instead waited for the old workbench target to disappear before reopening it. That target stayed listed for the 15-second limit, so the wait timed out again. No third attempt or broader investigation was made. The cause of this second observation is unresolved.

Both diagnostics preserve console output and result JSON. The source build was unchanged between runs. The page was marked before the reload request, but the post-restart marker and overlay assertions were never reached. These failures do not establish whether the product lifecycle fix works.

These are partial automated Chrome for Testing checks on macOS. They do not establish granted behavior, release readiness, everyday Chrome behavior, physical pointer behavior, native Deny, Microsoft Excel compatibility, or other-browser/platform acceptance. Remaining pre-grant checks and the specified export/screenshot/backup housekeeping were not reached. Local home paths in text and JSON have been replaced with `<repository>` or `<home>`.
