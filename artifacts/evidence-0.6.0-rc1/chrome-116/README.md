# Evidence: 0.6.0 release candidate 1 on Chrome 116 (October 3, 2026)

The checks that need no optional grants, on **Chrome for Testing 116.0.5845.96** for macOS, the oldest version Link Meteor supports, on `33ed915`. Run with `npm run check -- artifacts/evidence-0.6.0-rc1/chrome-116` and `LINK_METEOR_CHROME_PATH` pointing at the Chrome 116 app, skipping the suites named below. The [summary](summary.md) links every log.

**Result: every suite that ran passed, and the minimum stays at 116.** One suite, `access-content`, passed on Chrome 116 on October 2 and could not be finished there on October 3 (below).

| Check | Result on 116 | Notes |
| --- | --- | --- |
| Unit tests | 321 pass, 1 skipped | [Log](logs/unit.txt). |
| `pdf-browser` | 13/13 | [Results](pdf-browser-results.json). **The point of this run.** Chrome 116 lacks `Promise.withResolvers` and async iteration of `ReadableStream`; with Link Meteor's two shims the shipped PDF.js reads every fixture as Node does, and combines PDFs. |
| `lookup-browser` | 19/19 | [Results](lookup-browser-results.json). The sandboxed frame, and a whole lookup run. |
| `scroll-content` | 11/11, simulation | [Results](scroll-content-results.json). |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). |
| `backup-browser` | 23/23 | [Results](backup-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `reading-browser` | 12/12 | [Results](reading-browser-results.json). |
| `imports-browser` | 13/13 | [Results](imports-browser-results.json). A PDF file among the sources. |
| `move-browser` | 6/6 | [Results](move-browser-results.json). |
| Audits: overlay, actions, regressions | Pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). |
| `site-check` | Pass | [Results](site-results.json). |
| `access-content` | 55/55 on October 2; stopped on October 3 | [October 2 results](access-content-october-2/access-content-results.json), on `a106db0`, whose page script and suite are the ones tested here. See below. |

## The suite that stopped

On October 3, `access-content` on Chrome 116 stopped every time at the same place: after the clipboard checks of the menu notice, Chrome 116 confirmed closing that page and then never closed it, so the suite waited. [Log](../diagnostics/chrome-116-access-content-stopped.txt).

- It is not the new code: a copy of the code from before the frames and runs work stopped at the same place that day, and that part of the suite is unchanged since 0.5.0, where it passed on Chrome 116.
- It is not Chrome 151: the same suite passes there, on three systems.
- It had passed on Chrome 116 the evening before with this page script, and once more on the morning of October 3.

So it is recorded as a problem between Chrome for Testing 116 and that Mac on that day, cause not found, and `access-content` is to be run on Chrome 116 again at release preparation.

## Not checked on Chrome 116

- **Anything behind the toolbar button:** `access-browser`, `capture-page-access`, `pdf-tab-browser`, `coverage-browser`, `runs-browser` and `pdf-files-browser` press Chrome's toolbar action through a DevTools command Chrome 116 doesn't have. So *Capture this PDF*, Follow Next, frames with only the toolbar's access, and the ZIP and combined PDF were checked on Chrome 151; on 116 the same reader, page script and lookup were checked by the suites above.
- **The granted suites** were not run on 116.
