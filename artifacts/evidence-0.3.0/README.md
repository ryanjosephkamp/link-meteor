# Evidence: 0.3.0 foundation checks (September 26, 2026)

These results come from the 0.3.0 **foundation** build on the `claude/0.3.0` integration branch, source commit `1a308a3`. That build has the version set to 0.3.0, the additive settings and backup format in the data model, the workbench and shared background code split into area modules, and the reusable toolbar-action test helper. It adds no user-facing feature and no permission. It is not a release build: no ZIP was packaged, and the 0.3.0 features themselves are not built yet. Release evidence for 0.3.0 belongs in a new folder.

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | 46 tests: 45 pass, 1 skipped | [Output](node-tests.txt). The skip is the current-ZIP check, because no 0.3.0 ZIP is packaged yet; the ZIP verifier's own checks ran on the 0.2.2 ZIP. |
| `tests/visual-browser.mjs` | Pass, 11 checks | [Results](visual-results.json). New task-owned profile. Seeded with the 0.2.2 browser suite's export (`LINK_METEOR_SEED_JSON`), because it ran before this build's browser suite. About shows `v0.3.0` from the manifest. |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). The site is unchanged; it still offers 0.2.2. |
| `tests/capture-page-access.mjs` | Pass | [Results](capture-page-access.json). Now uses `tests/helpers/action.mjs`: 37 links on the first site, denied after the tab moves, 38 after a toolbar press on the new site, with no lasting site access. |
| `tests/browser.mjs` | 27/27 on the second visible run | [Results](browser-results.json). Workbench screenshots are in [`browser-screens/`](browser-screens/), because the visual suite uses the same file names. |
| `tests/extended-browser.mjs` | 8/8 | [Results](extended-browser-results.json). |
| `tests/site-browser.mjs` | Pass | [Results](site-browser-results.json). All eight practice answer keys, and 95 links for the whole page, as in 0.2.2. |
| `tests/audit-granted-regressions.mjs` | 4/4 | [Results](granted-regressions.json). |
| `tests/verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10, not Microsoft Excel. |
| `tests/permission-browser.mjs` | 3/3, run last | [Results](permission-browser-results.json). |

The functional suites used a new task-owned profile. Its optional grants (tabs, the local fixture origin and bookmarks) were requested by the product itself, each with an active user gesture, in a visible Chrome for Testing window. The tabs request resolved after 77 seconds. The site and bookmark requests resolved 1.3 and 1.2 seconds after they appeared. Whether each was a native Allow click is recorded only once the project owner confirms it.

**Diagnostic run.** The first visible run of `tests/browser.mjs` passed eight checks and failed the ninth: a 2-pixel drag over a wrapped link reported `5 links selected` instead of `1 link selected` (`tests/browser.mjs`, line 70). The page's capture script is byte-for-byte the 0.2.2 script, and the test windows opened right after the owner's Allow clicks in the same kind of window. That points to the Mac's real pointer resting over the visible test window, the cause the owner confirmed for 0.2.2's first failure; here it is likely, not proven. The second visible run passed 27/27. The failed run is kept in [`diagnostics/browser-run1-headed-fail/`](diagnostics/browser-run1-headed-fail/).

These are automated Chrome for Testing checks on macOS. They show that the module split kept the tested workflows working. They are not evidence for the planned 0.3.0 features, for other browsers or systems, or for everyday Chrome use.
