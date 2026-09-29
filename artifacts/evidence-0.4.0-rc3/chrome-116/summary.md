# Checks without grants: FAIL

Link Meteor 0.4.0 on darwin (arm64), Node v25.2.1, Chrome for Testing 116.0.5845.96. Started 2026-09-29T14-42-06-536Z.

| Check | Result | Seconds | Log or reason |
| --- | --- | --- | --- |
| build | pass | 0 | [logs/build.txt](logs/build.txt) |
| unit | pass | 2 | [logs/unit.txt](logs/unit.txt) |
| access-browser | fail | 15 | [logs/access-browser.txt](logs/access-browser.txt) |
| capture-page-access | fail | 17 | [logs/capture-page-access.txt](logs/capture-page-access.txt) |
| access-content | pass | 37 | [logs/access-content.txt](logs/access-content.txt) |
| exports-browser | pass | 13 | [logs/exports-browser.txt](logs/exports-browser.txt) |
| backup-browser | pass | 35 | [logs/backup-browser.txt](logs/backup-browser.txt) |
| downloads-browser | pass | 3 | [logs/downloads-browser.txt](logs/downloads-browser.txt) |
| audit-overlay | pass | 2 | [logs/audit-overlay.txt](logs/audit-overlay.txt) |
| audit-actions | pass | 2 | [logs/audit-actions.txt](logs/audit-actions.txt) |
| audit-regressions | pass | 2 | [logs/audit-regressions.txt](logs/audit-regressions.txt) |
| visual-browser | pass | 16 | [logs/visual-browser.txt](logs/visual-browser.txt) |
| site-check | pass | 88 | [logs/site-check.txt](logs/site-check.txt) |
| sync-site | skip |  | no artifacts/link-meteor-0.4.0.zip yet; package this version first |
