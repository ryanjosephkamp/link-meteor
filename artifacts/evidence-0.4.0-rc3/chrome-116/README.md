# Evidence: 0.4.0 release candidate 3 on Chrome 116 (September 29, 2026)

The checks that need no optional grants, on **Chrome for Testing 116.0.5845.96** for macOS, the oldest version Link Meteor supports, with the release candidate 3 source (`02e6b3d`). Run with `npm run check -- artifacts/evidence-0.4.0-rc3/chrome-116 --minutes 10` and `LINK_METEOR_CHROME_PATH` pointing at the Chrome 116 app; the [summary](summary.md) links every log. How the download was checked, and the probes behind the notes below, are in [release candidate 2's Chrome 116 evidence](../../evidence-0.4.0-rc2/chrome-116/README.md), which found the bug this release candidate fixes.

**Result: every suite that can run on Chrome 116 passed. The minimum stays at 116.**

| Check | Result on 116 | Notes |
| --- | --- | --- |
| Unit tests | 162 pass, 1 skipped | [Log](logs/unit.txt). |
| `access-content` | 45/45, simulation | [Results](access-content-results.json). Includes the shadow-root selection release candidate 2 missed. 5 clipboard reads checked the plain text only, because Chrome 116's headless clipboard can't be read with `navigator.clipboard.read()`. |
| `exports-browser` | 24/24 | [Results](exports-browser-results.json). Custom columns included. 5 clipboard reads checked the plain text only, as above. |
| `backup-browser` | 22/22 | [Results](backup-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| Audits: overlay, actions, regressions | Pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 14 checks, pass | [Results](visual-results.json). Every theme in light and dark. The toolbar icon isn't recorded on 116, because the test tool can't reach the service worker's extension APIs there. |
| `site-check` | Pass | [Results](site-results.json). |
| `access-browser` | 5 checks, then stopped | [Log](logs/access-browser.txt). Check 6 presses Chrome's toolbar button through `Extensions.triggerAction`, which Chrome 116 doesn't have. |
| `capture-page-access` | Can't run on 116 | [Log](logs/capture-page-access.txt). The same toolbar command. |

The clipboard and service-worker fallbacks engage only when `LINK_METEOR_CHROME_PATH` points at another Chrome, and each says in its results what it couldn't check. The granted suites were not run on 116.
