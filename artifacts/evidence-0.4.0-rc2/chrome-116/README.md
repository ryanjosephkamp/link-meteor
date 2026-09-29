# Evidence: 0.4.0 release candidate 2 on Chrome 116 (September 29, 2026)

Link Meteor declares Chrome 116 as its oldest supported version (`minimum_chrome_version`). These results come from the checks that need no optional grants, run on **Chrome for Testing 116.0.5845.96** for macOS ([version record and probes](chrome-version.txt)), on the release candidate 2 source (`b0ae18e`).

**Result: one real bug, fixed in release candidate 3.** On Chrome 116, *Capture links in the selection* found no links when the selected text was inside a shadow root. Chrome 116 reports such a selection as collapsed (`Selection.isCollapsed` is true) although its range isn't, and Link Meteor trusted that flag. Current Chrome reports it correctly. Release candidate 3 judges each range instead; see [its Chrome 116 results](../../evidence-0.4.0-rc3/chrome-116/README.md).

## How the checks were run

`npm run check -- artifacts/evidence-0.4.0-rc2/chrome-116 --minutes 10`, with `LINK_METEOR_CHROME_PATH` pointing at the Chrome 116 app. The [summary](summary.md) is that first run. With that variable set, the helpers add `--headless=new`, because before Chrome 132, bare `--headless` starts the old headless mode, which runs no extensions.

The first run found three test-tool limits on Chrome 116, none of them in Link Meteor:
- **The clipboard.** Chrome 116's headless clipboard can't be read with `navigator.clipboard.read()`, even after a plain-text copy. Plain text reads back with `readText()`, and a rich copy pastes into a page as a clickable link, as on current Chrome (probe results in [chrome-version.txt](chrome-version.txt)). `access-content` and `exports-browser` stopped at their first rich-copy check.
- **The service worker.** Playwright's view of the service worker has no extension APIs on Chrome 116, while the extension's own pages have them all. `visual-browser` stopped at its first step, which records the toolbar icon.
- **The toolbar button.** As for 0.3.0, `access-browser` and `capture-page-access` press Chrome's toolbar button through DevTools commands that Chrome 116 doesn't have.

So the first two suites now read plain text when the normal read fails, and the visual suite skips only the toolbar icon when it can't reach the worker's APIs. Both fallbacks engage only when `LINK_METEOR_CHROME_PATH` points at another Chrome, and each says in its results what it couldn't check. The reruns found the bug above.

## Results

| Check | Result on 116 | Notes |
| --- | --- | --- |
| Unit tests | 162 pass, 1 skipped | [Log](logs/unit.txt). |
| `backup-browser` | 22/22 | [Results](backup-browser-results.json). Custom columns included. |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| Audits: overlay, actions, regressions | Pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `site-check` | Pass | [Results](site-results.json). |
| `exports-browser` | 24/24 on the rerun | [Results](exports-browser-results.json). The first run stopped after 12 at the clipboard ([log](logs/exports-browser-run1.txt)). The rerun checked only the text of 5 clipboard reads, not their HTML. |
| `visual-browser` | 14 checks, pass on the rerun | [Results](visual-results.json). Every theme in light and dark: contrast and no overflow at 320 px. The toolbar icon wasn't recorded ([first run](logs/visual-browser-run1.txt)). |
| `access-content` | 42 of 45, then the bug | [Log](logs/access-content.txt). The first run stopped after 26 at the clipboard ([log](logs/access-content-run1.txt)). The rerun stopped at the shadow-root selection. |
| `access-browser` | 5 checks, then stopped | [Log](logs/access-browser.txt). The toolbar button, as above. |
| `capture-page-access` | Can't run on 116 | [Log](logs/capture-page-access.txt). |

## Static check

Nothing in the 0.4.0 source is newer than Chrome 116: no newer JavaScript or CSS feature, and every extension API it uses predates 116, including `chrome.downloads`, context menus on the toolbar icon, and `chrome.action.setIcon` with image data drawn on an `OffscreenCanvas`.
