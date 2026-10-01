# Evidence: 0.5.0 release candidate 3 on Chrome 116 (October 1, 2026)

The checks that need no optional grants, on **Chrome for Testing 116.0.5845.96** for macOS, the oldest version Link Meteor supports, with the release candidate 3 source (`91e851b`). Run with `npm run check -- artifacts/evidence-0.5.0-rc3/chrome-116 --minutes 10` and `LINK_METEOR_CHROME_PATH` pointing at the Chrome 116 app. The [summary](summary.md) links every log.

**Result: every suite that can run on Chrome 116 passed. The minimum stays at 116.**

| Check | Result on 116 | Notes |
| --- | --- | --- |
| Unit tests | 234 pass, 1 skipped | [Log](logs/unit.txt). |
| `access-content` | 50/50, simulation | [Results](access-content-results.json). Clipboard reads checked the plain text only, because Chrome 116's headless clipboard can't be read with `navigator.clipboard.read()`. |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). Citation formats included. Clipboard reads as above. |
| `backup-browser` | 23/23 | [Results](backup-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `reading-browser` | 12/12 | [Results](reading-browser-results.json). First run on Chrome 116. |
| `imports-browser` | 12/12 | [Results](imports-browser-results.json). First run on Chrome 116. |
| `move-browser` | 6/6 | [Results](move-browser-results.json). First run on Chrome 116. |
| Audits: overlay, actions, regressions | Pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). Every theme in light and dark. |
| `site-check` | Pass | [Results](site-results.json). |
| `access-browser` | 5 checks, then stopped | [Log](logs/access-browser.txt). Check 6 presses Chrome's toolbar button through `Extensions.triggerAction`, which Chrome 116 doesn't have. |
| `capture-page-access` | Can't run on 116 | [Log](logs/capture-page-access.txt). The same toolbar command. |

## What the first run found

The first run on Chrome 116 failed `visual-browser`: the suite waited for `document.getAnimations()` to be empty before measuring contrast, and Chrome 116 keeps finished transitions in that list, so the wait never ended. The colors had settled. The suite now waits only for transitions that are still running (`daef56f`), and the rerun passed. The [first log](../diagnostics/chrome-116-visual-browser-first-run.txt) is kept.

## Not checked on Chrome 116

- **The toolbar button,** including the second click that closes the side panel. The test tool can't press it there. Chrome 116 has no `chrome.sidePanel.close`, so the panel closes itself with `window.close()`; that path is checked on Chrome 151 by replacing Chrome's own close.
- **The granted suites** were not run on 116.
