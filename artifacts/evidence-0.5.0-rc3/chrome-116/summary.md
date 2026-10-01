# Checks without grants: FAIL

Link Meteor 0.5.0 on darwin (arm64), Node v25.2.1, Chrome for Testing 116.0.5845.96. Started 2026-10-01T17-10-08-560Z.

| Check | Result | Seconds | Log or reason |
| --- | --- | --- | --- |
| build | pass | 0 | [logs/build.txt](logs/build.txt) |
| unit | pass | 2 | [logs/unit.txt](logs/unit.txt) |
| access-browser | fail | 15 | [logs/access-browser.txt](logs/access-browser.txt) |
| capture-page-access | fail | 17 | [logs/capture-page-access.txt](logs/capture-page-access.txt) |
| access-content | pass | 39 | [logs/access-content.txt](logs/access-content.txt) |
| exports-browser | pass | 15 | [logs/exports-browser.txt](logs/exports-browser.txt) |
| backup-browser | pass | 36 | [logs/backup-browser.txt](logs/backup-browser.txt) |
| downloads-browser | pass | 3 | [logs/downloads-browser.txt](logs/downloads-browser.txt) |
| reading-browser | pass | 6 | [logs/reading-browser.txt](logs/reading-browser.txt) |
| imports-browser | pass | 10 | [logs/imports-browser.txt](logs/imports-browser.txt) |
| move-browser | pass | 3 | [logs/move-browser.txt](logs/move-browser.txt) |
| audit-overlay | pass | 2 | [logs/audit-overlay.txt](logs/audit-overlay.txt) |
| audit-actions | pass | 2 | [logs/audit-actions.txt](logs/audit-actions.txt) |
| audit-regressions | pass | 2 | [logs/audit-regressions.txt](logs/audit-regressions.txt) |
| visual-browser | pass | 22 | [logs/visual-browser.txt](logs/visual-browser.txt) |
| site-check | pass | 88 | [logs/site-check.txt](logs/site-check.txt) |
| sync-site | skip |  | no artifacts/link-meteor-0.5.0.zip yet; package this version first |
