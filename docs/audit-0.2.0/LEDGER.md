# Astra audit of the Opus handback

- Timer started 2026-09-25T21:02:57Z. Closeout planning 2026-09-26T02:32:57Z; approximate six-hour limit 03:02:57Z. No earlier timer reused.
- Driver selected by user: GPT-6 Astra Xhigh. Project and remote verified; no repository AGENTS.md found. Working tree clean at entry (user's ignored unpacked build present).
- Protected Opus head/tag, prior Codex branch, main, draft PR #1, original ZIP and unpacked-file fingerprints recorded in START.json. Remote refs match local. Audit branch created from exact handback head: codex/audit-0.2.0.
- Original ZIP 191,513 bytes and SHA-256 1cb1b778a91180709455e273eb9b0f1cbefe758a6e43d01156729c14330fc197 verified, including CRC and every per-file hash. All 13 archive files are identical to branch-head src files. User's unpacked directory was read only for fingerprints and will not be used as a test profile/build.
- Initial project footprint 90 MB, scratch 72 MB. Disk available approximately 22 GiB (95% capacity). Reuse installed runtimes; no downloads or installs planned.
- User reports the unpacked 0.2.0 worked in everyday Chrome, without itemized steps. This is human-use testimony, not test coverage for particular interactions. Automated optional grants do not establish native Allow/Deny acceptance.

## Dispatch receipts

1. `/root/audit_workbench`: gpt-6-sol, xhigh, fork none. Accepted dispatch. Read-only UI/behavior audit; exclusive write ownership docs/audit-0.2.0/worker-workbench.md. No nested workers, browsers, Git writes or product changes.
2. `/root/audit_site`: gpt-6-sol, high, fork none. Accepted after the independent review boundaries settled. Read-only site/workflow/claims audit; exclusive write ownership docs/audit-0.2.0/worker-site.md. Same limits. Astra owns architecture, capture/background review, test execution, integration and acceptance.

## Plan and acceptance map

1. Verify protected identities and ZIP/source equivalence; compare model/export/manifest/background/capture claims with baseline a6dddac.
2. Audit workbench behavior and site factual claims/workflow independently. Reproduce concrete findings before accepting them; repair within existing scope.
3. Execute npm test and loaded-extension browser, extended, site, visual and permission suites against extracted packaged bytes. Use fresh task-owned profiles, prepare-grants, and separate evidence directories. Run permission revocation last for each profile.
4. Independently read actual downloads; run site-check and sync-site --check. Add targeted regression checks for new Select all N, batch filters, inline confirmation and any discovered defects.
5. If product repairs are needed, create a new versioned artifact; retain the original ZIP and user's unpacked folder untouched. Test changed packaged bytes in a new profile and describe reload implications.
6. Verify protected refs/files and resource cleanup, checkpoint/push only the audit branch, provide canonical Markdown and standalone mobile HTML with an exact next prompt. Merge/deploy remains the user's decision; no deployment, workflow dispatch, PR mutation or merge.

## Evidence handling

Audit receipts go under artifacts/audit-0.2.0, keeping Opus's evidence intact. Harness additions permit a chosen evidence directory and an extracted packaged build path; existing assertions remain unchanged. Permission-grant comments/labels are corrected to avoid implying native prompt evidence.

## Initial review and repairs

- Original source comparison confirms byte-identical model/export/XLSX, manifest differing only by version, background adding only collection.active, and unchanged extraction/geometry/scanning function regions. Full diff independently reviewed; SOURCE-COMPARISON.json records identity.
- Original packaged build reproduced hidden-selection removal, row-checkbox focus loss, stale batch wording, and report actions surviving a collection switch. The original build passed Select all 205/export, exact batch count and schema/occurrence preservation probes. New probes are actual loaded extension checks, not design mocks.
- Workbench worker repaired visible-selection removal, selection count wording, stable row/tab keyboard focus and report/filter synchronization. Astra reviewed the changes. Site worker added a main-only manual-job guard, actual ZIP-member/source verification with corruption/stale-source tests, accurate user-report wording and semantic export-preview headers. Astra reviewed those changes too.
- Astra repaired region destination refresh and save receipt wording, prevented simultaneous actions from committing the same region twice, and qualified the button selector so preview text cannot be mistaken for the Add another region button. Version 0.2.1 will be packaged in new paths; original 0.2.0 files remain untouched.
- npm test at original product source: 23 pass. Original site sync check: pass. Current in-progress source intentionally differs from original package; acceptance of the repaired build is pending packaging and rerun.
- Initial headed grant preparation and one focused-window retry timed out at optional tabs access. They closed their owned browsers/servers. A SIGINT attempt found the first process had already exited; no process was killed. Native automation bound a separate New Tab test-browser process, so no permission was clicked or claimed. Short headless diagnostics also remain automation-only and do not change permission grants externally.

## Integrated candidate and closeout

- First coherent source checkpoint e8e69cf734ed750ee6b792cc3cae1f9bf898ce62 pushed and remote SHA matched. New 0.2.1 ZIP is 193,346 bytes, SHA-256 231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9, with all 13 src members independently matched. Packaged source was clean. The public-site source retains the development ZIP offering and old ZIP while pointing its candidate metadata at 0.2.1. No publication happened.
- Both workers completed; their writes were reconciled and reviewed. Only Astra ran and accepted the integrated browser/data checks. Seven regression checks, nine stored-data/action checks, four content-component checks, visual checks, site checks, seven-format independent reads and source/package sync pass. See ACCEPTANCE.md and JSON receipts for exact limits.
- The optional tabs request still remains pending on the repaired package (fresh audit-021-final-grants profile, 30-second bounded headed attempt): activeGesture true, no resolved grant or error, no optional permissions. Functional, extended, practice-page and revocation suites remain blocked before execution. The user's availability question remains unanswered at closeout preparation; no security setting or permission state was bypassed.
- An attempted visual rerun reused a seeded fixture profile, so globally unique duplicate occurrence IDs could not populate a second collection. Kept the diagnostic receipt, reran in fresh audit-021-visual-steady and passed. Screenshots now disable transient animations so the desktop image shows the completed entry transition.
- No dependencies, browser binaries or fonts were downloaded; no global installs. Profiles and caches are under .scratch. Project footprint grew from about90 MB to about182 MiB during checks; disk availability fell from about22 GiB to about16.2 GiB system-wide (97% capacity) (not attributed to this task). No peak-RAM measurement is claimed. Scripts close only their own contexts/servers in finally. Final cleanup is read-only process verification; no unrelated app/process was stopped.
- Source/build identity, exact report prompt, tests and outstanding human merge/deploy decision are in the mobile handback. Stop after that handback; no follow-on iteration is scheduled.
