# Link Meteor — integration and publication proposal

**Recommendation: integrate the audited 0.2.1 snapshot through one new PR, then publish the development website with one manual Pages run. Keep Chrome Web Store submission and your everyday-installation update separate.** This document is a proposal for your decision. No PR, protected branch, deployment setting or installed extension was changed to prepare it.

The exact next prompt at the end authorizes that recommended integration and website publication if you choose to send it. It explicitly accepts the possible indirect merge status of the original PR. It does not authorize Store submission or access to your personal collection data.

## What I reverified

The working directory is `/Users/noir/Documents/link-meteor`, the only remote is `https://github.com/ryanjosephkamp/link-meteor`, and the entry tree was clean on `codex/audit-0.2.0` at **696620091f7a92d3814e390582942c5f5db926b7**. Local and remote audit heads matched. No repository or ancestor `AGENTS.md` was found. I read the approved alignment, contracts, acceptance history, site instructions and resumed audit report/ledger/receipts.

| Item | Current verified state |
| --- | --- |
| `main` | `9efb43350a0115c15b059b428f7cc8bffcbd59b1` |
| `codex/chrome-v1` | `499c3ab1551a09338529f9f7ecabbf5c3048df38` |
| `claude/design-v1` | `41f82e58066d57aa19c44b00dc8bb07c8cf81407` |
| `opus-handback-2026-09-25` | Annotated tag object `91811fe331616b4aaaef502d4dcade5f24aca9a1`, target `41f82e58066d57aa19c44b00dc8bb07c8cf81407` |
| [Draft PR #1](https://github.com/ryanjosephkamp/link-meteor/pull/1) | Open, draft; `claude/design-v1` → `main`; mergeable, no status checks reported. Its head does not include the audit repairs. |
| Repository | Public; default branch `main`; merge commits allowed; automatic branch deletion off. |
| Pages and Actions | Pages not enabled (`has_pages: false`). Actions enabled and all actions allowed. `main` reports no protection and no applicable rules. These observations are not instructions to alter protections. |

The unchanged [0.2.1 ZIP](../../../artifacts/link-meteor-0.2.1.zip) is **193,346 bytes**, SHA-256 **231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9**. All 13 members match both current `src/` and the per-file receipt; the site's downloadable copy matches too. Product source remains **e8e69cf734ed750ee6b792cc3cae1f9bf898ce62**. The original ZIP and all 13 fingerprints in your protected unpacked 0.2.0 folder are unchanged. Full facts: [VERIFICATION.json](VERIFICATION.json).

## Integration: one PR containing the complete history

Create the proposed **`codex/release-0.2.1`** branch from exactly **696620091f7a92d3814e390582942c5f5db926b7** after authorization. Open a new PR into `main` titled **Integrate audited Link Meteor 0.2.1 and development website**. The [prepared title and description](PROPOSED_PR.md) are local files only; no new PR exists yet.

This freezes the tested implementation and its completed handback. Proposal-only commits added later on the audit branch are documentation backups and need not enter the first integration. The ancestry check found **13 commits ahead of main, zero main-only commits**. No cherry-pick, rewrite or intermediate 0.2.0 merge is needed.

The complete proposed commit set, oldest first:

| Commit | Contribution |
| --- | --- |
| `123da8f7cd5155924a180c6ef4fafa16fdc16adc` | Approved scope and implementation plan |
| `17b9186a93dc0d626f86069271cac1ada6724e2f` | Chrome capture, collections, exports and harness |
| `a6dddac13b14307e6a343e78d540167c1232dc4b` | Tested pre-design baseline and edge-case repairs |
| `499c3ab1551a09338529f9f7ecabbf5c3048df38` | Chrome baseline delivery and Opus handoff |
| `7a45e91d4801568e88be762625d93fcf2ffbd8c0` | Opus redesign of workbench, overlay and branding |
| `7c9ca4aaab11eb405e9cdea4d6f786cd05114efb` | Frozen 0.2.0 product source and selection/site tests |
| `3ec056cbf5aa19edec6979ca6a3547f2c1bd5567` | Website, design documentation and Opus evidence |
| `41f82e58066d57aa19c44b00dc8bb07c8cf81407` | Protected Opus handback and user-review record |
| `e8e69cf734ed750ee6b792cc3cae1f9bf898ce62` | Astra's 0.2.1 product and site-check repairs |
| `2bac1d9c1d3501aa6b6de283ad8865398bc497c9` | 0.2.1 package and independent audit evidence |
| `7ce68674dcf04f714831948e49706fac909f43d6` | Preserved blocked-audit closeout |
| `20699de291d31554c0de2e55b8ab9e4609216fa8` | Completed grant-dependent checks and honest site status |
| `696620091f7a92d3814e390582942c5f5db926b7` | Final automated-audit handback and preservation receipts |

After your authorization, reverify those refs, run `npm test` and `node scripts/sync-site.mjs --check` on the frozen snapshot, and inspect any newly required checks. Merge the new PR using **Create a merge commit**. Retain all branches and tags. A merge commit preserves the original source/evidence SHAs; its hash cannot be known before GitHub creates it. Verify its first parent is the approved main, its second parent is the approved integration head, all 13 commits remain ancestors, and its tree equals the approved snapshot. Any ref drift, unexpected tree change or failed check stops the publication step.

**Original PR #1:** leave its head, base, title and draft state alone before integration. Do not directly close, merge or retarget it. GitHub can mark a PR indirectly merged when its existing commits enter the base through another PR. This may happen to #1 through the proposed merge; if it stays open, leave it open and report that state. Approval of this route must include that possible automatic status change. [GitHub's indirect-merge behavior](https://docs.github.com/en/pull-requests/reference/pull-request-merges).

The repair commit retains schema v1, original link fields, permissions and the export/model cores. It fixes hidden-selection removal, keyboard focus, stale batch/destination wording and overlapping regional saves; it also verifies package contents and constrains the site workflow to main. Integrating only PR #1 would omit these repairs.

## Website: exact manual publication sequence

The proposed public URL is **https://ryanjosephkamp.github.io/link-meteor/**. The site continues to offer the development ZIP for free and clearly says the extension is not yet in the Chrome Web Store. Publishing this site does not install or update anybody's extension.

The current workflow `.github/workflows/pages.yml` has only `workflow_dispatch`, a `main`-only job condition, `cancel-in-progress: false`, the `github-pages` environment, and permissions `contents: read`, `pages: write`, `id-token: write`. It uses checkout v4, setup-node v4 with Node 22, configure-pages v5, upload-pages-artifact v3 and deploy-pages v4. It verifies source/site/package consistency before uploading **only `site/`**. There is no push, PR, schedule or Store publishing trigger. Its one job uploads before deploying, so it does not need an inter-job dependency. [GitHub Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [deploy-pages action](https://github.com/actions/deploy-pages).

| Step | Proposed action and completion evidence |
| --- | --- |
| 1. Integrate | Complete the exact merge above and record its SHA. Do not run Pages from an audit or design branch. |
| 2. Check prerequisites | Confirm Actions remains available, action versions are compatible at execution, and the `github-pages` environment permits main. Respect any owner approval requirement. No secrets or personal token are needed by this workflow; it uses GitHub's job token. |
| 3. Enable this site's source | In this repository's **Settings → Pages → Build and deployment**, choose **GitHub Actions**. This is a future, explicitly authorized repository setting change. If owner access is required, the owner performs it. No custom domain or DNS change is proposed. |
| 4. Dispatch once | In **Actions → Deploy site to GitHub Pages (manual) → Run workflow**, choose **main** and run once. Verify the run's `head_sha` is the just-approved merge. Record run ID, source SHA and deployment result. |
| 5. Verify the live result | Confirm HTTPS home/install/guide/privacy/practice pages, fonts/images/modules, keyboard navigation and a nested missing path's 404 assets. Download the public 0.2.1 ZIP into task scratch and independently match its size/hash. Check the practice page and export preview in the deployed path. |
| 6. Hand back | Report live URLs, workflow/run/merge identity, download hash, actual checks and any remaining human checks. No automatic rerun or next publication. |

The workflow must be on the default branch before a manual dispatch is available. A merge alone does not start it. [GitHub manual-workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Current repository settings satisfy the basic Actions prerequisites; Pages activation and the environment's eventual deployment approval have not been exercised. Official action documentation still shows the upload-v3/deploy-v4 combination, but this is not proof that a GitHub-hosted run succeeds. Recheck at execution; any necessary workflow repair should be reviewed before dispatch. [Upload action documentation](https://github.com/actions/upload-pages-artifact).

If the first run fails, retain the run URL and logs and stop; do not retry indefinitely, change protections or claim a live site. There is no earlier Pages deployment to roll back to. If a live defect is found, preserve the evidence and request a bounded corrective action. History recovery uses new commits and an explicitly authorized redeployment, never reset/force-push.

The Pages upload excludes repository docs, test profiles and local collection backups. This repository is already public, so committed files are nevertheless public through GitHub itself; personal exports must stay uncommitted. All features remain free, with no accounts, ads, telemetry, backend dependency or paid tier.

## Your unpacked 0.2.0 installation: preserve path, ID and state

**User-controlled steps for later; none performed here or authorized by the embedded website-publication prompt.** Keep the existing Chrome profile, extension entry and exact folder path:

`/Users/noir/Documents/link-meteor/artifacts/link-meteor-0.2.0/`

The folder's old version number can remain in its name. Both manifests lack a fixed `key`; don't rename/move the folder, uninstall the extension, clear extension data, add a key, or use **Load unpacked** on the separately extracted 0.2.1 directory as an update. Record the current extension ID shown at `chrome://extensions` before changing files; compare that same card and ID afterward. This same-path procedure is expected to retain the existing identity and storage, but your real-profile update has not been tested.

1. **Save your work and make recovery copies.** In each collection, clear filters and batch filtering, choose no grouping, and clear row selection so export covers the full collection. Export JSON and optionally XLSX; check the exported row count. Record collection names, notes/tags and counts. Link exports are useful records, **not a complete app backup or an importable restore package**.
2. **Preserve full local state if the collections matter.** Before disabling the extension, open Link Meteor's full workbench, use that extension page's DevTools Console, and read the code below before running it. It copies only this extension's local-storage snapshot to your clipboard; it does not write storage. Save the pasted JSON to a private local file, for example `.scratch/manual-update-backup/link-meteor-local-state.json`, never to tracked evidence or this chat. If you are not comfortable using DevTools, pause the update and request guided backup help. Do not disable any browser security restriction to run it.

```js
copy(JSON.stringify(await chrome.storage.local.get(null), null, 2))
```

That DevTools-only command uses the Console's `copy` helper. The snapshot should contain `linkMeteorState` with `schemaVersion: 1`, the full `collections`, notes/tags, settings and undo state. It does not contain Chrome's permission grants or a complete browser-profile backup. There is no built-in import/restore flow; raw JSON is recovery evidence, not a guarantee of one-click recovery.

3. **Stage outside the installed folder.** Copy the existing 0.2.0 code to a distinct backup path under ignored `.scratch/`, keeping the live folder in place. Verify the candidate ZIP's exact hash above and unpack into a different staging directory. Confirm the staged root contains `manifest.json` version 0.2.1 and all 13 receipt-matching files. A code-folder backup alone does not back up collections.
4. **Replace files in place, then reload.** Save any collection edits, close Link Meteor views, and temporarily disable only Link Meteor using its existing extension card. Replace its code files with the verified staged contents inside the same original folder; avoid nesting another folder beneath it. Do not remove the Chrome extension entry or alter storage files. Re-enable and reload the same extension card. Reload the ordinary webpages you want to capture so they get fresh content scripts. [Chrome reload guidance](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
5. **Verify before new work.** Confirm version 0.2.1 and the unchanged ID, then compare every collection's count, notes/tags and representative links/provenance. Check a region, an export and persistence after an ordinary restart when convenient. If the ID changes, a collection disappears or an error appears, stop using it and preserve the before/after data. Do not uninstall or create a replacement collection to work around it.

For code rollback, keep the same path and original extension entry; the preserved 0.2.0 code can be restored there and reloaded. Schema v1 and the model/storage core are unchanged, but a rollback should still be verified and is not a substitute for the saved state. Restoring raw state needs a separately reviewed recovery operation.

**Store installation is a different transition.** Do not assume a later Store install shares this path-derived development ID or transfers collections. Chrome documents a manifest public key for consistent development/Store identity; adopting it now would change the tested manifest and may change the current installation's ID. We are not adding a key or designing migration in this proposal. Decide that transition before replacing an installation with valuable collections. [Chrome identity guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key).

## Before Chrome Web Store submission

The website can launch as an honestly labeled development site while these checks remain open. I recommend completing the following before a public Store release. These are remaining checks, not claims of failure or new feature requirements.

| Area | Concrete human acceptance |
| --- | --- |
| Everyday Chrome 0.2.1 | After the user-controlled update, check 2–3 real research/admin pages; native shortcut, Escape, side-panel opening/resizing, regional capture and hold mode. Confirm collections survive reload/restart. The existing human report covers only 0.2.0. |
| Actual permission UI | On a disposable manual test profile, observe and record Allow and Deny for optional requests. Keep an allowed tab, denied tab and restricted page in one capture to check honest partial results. Do not revoke useful everyday-profile grants merely to generate evidence. |
| Curation and actions | Select all matches across pages, change filters/batches, remove/undo, group/ungroup, create bookmarks, and confirm opening count/cap. Keep this bounded to a few disposable links. |
| Spreadsheet and accessibility | Open a real exported workbook in Microsoft Excel; confirm separate fields, empty labels, Unicode and literal formula-like strings. Try keyboard-only and a screen reader in the actual panel/workbench. |
| Supported environments | Test Windows/Linux activation before asserting those behaviors are verified. Chrome 116 is declared, not tested. Limit claims to observed environments or test the claimed minimum. Real phones/non-Chromium site behavior remains separate. |

For the later Store package: prepare an accurate single-purpose description, permission justifications, privacy declarations, contact/support details, suitable icons/screenshots and reviewer instructions using the public practice page. The existing ZIP is a candidate, not a Store-approved package. Owner registration, any one-time registration fee and two-step verification are owner actions; no credentials or settings changes are requested here. [Registration](https://developer.chrome.com/docs/webstore/register), [account prerequisite](https://developer.chrome.com/docs/webstore/using-api), [listing guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).

**Local processing still needs truthful user-data disclosure.** Links, source URLs, webpage labels and notes are handled even though they are not sent to a Link Meteor server. Use the eventual live privacy page, explain clipboard/downloads and browser bookmark sync, and do not simply select “no user data” because there is no telemetry. [Chrome's local-data disclosure policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

After those checks and a separate authorization, upload the verified package, complete listing/privacy/distribution details, and submit for review with **deferred publication** so passing review does not automatically publish. Actual public Store release remains an explicit owner decision. There is no Store submission or review result now. [Chrome submission and deferred publication](https://developer.chrome.com/docs/webstore/publish). Originality/name clearance remains unestablished as recorded in the approved alignment; this proposal does not supply legal clearance.

## Evidence and preparation limits

This turn reran read-only package/source/site checks, protected-file fingerprints, ancestry and GitHub metadata checks. It also validates this report's exact prompt and responsive layout. It did not rerun the unchanged extension's full suites or establish new product/human acceptance. The actual prior results remain in [the completed audit](../../audit-0.2.0/resume-01/REPORT.md) and [ACCEPTANCE.md](../../ACCEPTANCE.md): 27/27 browser checks, 8/8 extended checks, all eight practice keys, 4/4 regression checks, 3/3 revocation checks and independent seven-format reads. Optional grants succeeded under automation, but no driver-observed native Allow/Deny mechanism was established.

No worker, product build, installer update, dependency installation or live publication was needed for this proposal. Only new proposal/evidence files are saved on the audit branch. No files outside this project were deleted. Disk remains about 97% full, with about 16 GiB available; only a small report-validation browser is used, without an extension or personal profile. Earlier screenshots are linked from the audit rather than duplicated. Current official references were checked on September 25, 2026; execution must recheck mutable settings and requirements.

The accompanying handback states the final document commit and verified remote-backup status. [VALIDATION.json](VALIDATION.json) records actual report checks and their limits. Copy/mobile-preview behavior is deliberately untested; the full next prompt remains readable without JavaScript.

## Decision requested

**Approve the exact integration and manual development-site publication route above, while keeping Store submission and your installed-extension update deferred?** This authorization is needed because your current instruction permits preparation only. If you approve, send the exact next prompt below; if you prefer integration only or want different timing, request that change instead. No action is taken merely because this report exists.

## Exact next prompt

Copy is assumed unavailable in mobile preview. The complete text is provided for reading and reuse.

```text
You are the Link Meteor driver; I select GPT-6 Astra Xhigh. I approve the integration and development-website publication proposal in docs/publication-proposal/2026-09-25/REPORT.md. Execute its recommended route only in /Users/noir/Documents/link-meteor and https://github.com/ryanjosephkamp/link-meteor. This is authorization to integrate the audited 0.2.1 candidate and publish its GitHub Pages development site, not to submit or publish the extension to the Chrome Web Store or update my everyday Chrome installation.

First read the proposal, VERIFICATION.json, the completed audit in docs/audit-0.2.0/resume-01/, docs/ACCEPTANCE.md, the approved ALIGNMENT.md, docs/CONTRACTS.md and site/README.md. Reverify repository instructions, current files, Git state, remote refs, PR #1 and publication settings. Preserve all intervening work. The approved integration snapshot is 696620091f7a92d3814e390582942c5f5db926b7, containing all 13 proposed commits after main 9efb43350a0115c15b059b428f7cc8bffcbd59b1. Later proposal-only commits on codex/audit-0.2.0 do not alter that snapshot. Stop and report any change to the approved source, main, protected refs or package instead of silently broadening the merge.

Verify the unchanged artifacts/link-meteor-0.2.1.zip: 193346 bytes, SHA-256 231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9; all 13 members must match src and the receipt. Product source is e8e69cf734ed750ee6b792cc3cae1f9bf898ce62. Do not repackage unchanged source. Rerun npm test and node scripts/sync-site.mjs --check on the approved snapshot; confirm workflow action compatibility and any current merge/deployment requirements. Do not weaken protections or waive failed checks.

Create codex/release-0.2.1 from exactly 696620091f7a92d3814e390582942c5f5db926b7, or reuse it only if already identical. Push without force and create one integration PR from that branch into main using docs/publication-proposal/2026-09-25/PROPOSED_PR.md. Attach the PR to this task. Once its exact head, base and required checks are verified, merge it using a merge commit, without squash, rebase or deleting branches. I authorize main to advance only through this merge. Verify both parents, inclusion of all original commits, and an integrated tree identical to the approved snapshot before deployment.

Do not directly merge, close, retarget or edit draft PR #1. I understand and accept that GitHub may mark it indirectly merged when its commits enter main through the new integration PR. Report the actual resulting state; if it remains open, leave it for me. Do not move, delete, rewrite or force-push claude/design-v1, codex/chrome-v1 or opus-handback-2026-09-25. Keep the audit history intact.

I authorize the repository-specific Pages Source to be set to GitHub Actions for this repository only; no other account or security setting may be changed. If owner UI access or an environment approval is needed, ask me once for that exact action and pause only the dependent step. No credentials, payments, protection changes or authentication workarounds. Dispatch .github/workflows/pages.yml once on main after verifying its ref is the approved integration merge. Record the workflow run ID and head SHA, wait for completion, then verify the live HTTPS site, guide, privacy, practice page, assets, nested 404 behavior and development ZIP hash. Confirm the workflow published only site/. Stop and report a failed run without automatically retrying or changing the workflow. Preserve the free development ZIP offering and the factual testing limitations.

Do not write, move or overwrite artifacts/link-meteor-0.2.0/, access personal collection data, or operate my everyday Chrome profile. The same-path installation update remains user-controlled. Do not upload or submit to the Chrome Web Store, launch Claude Code, add features, change permissions or storage schema, begin ports or AI work, deploy elsewhere, or schedule future runs. Preserve unrelated sessions/apps/processes, delete nothing outside this project, install no heavyweight dependencies and keep task resources bounded.

Record a new elapsed timer, save coherent evidence on the audit branch and verify remote backups. At completion or a concrete blocker, produce a standalone mobile-readable HTML handback using /Users/noir/.codex/skills/render-mobile-html-report/SKILL.md, canonical Markdown and one exact readable next prompt. Include integration PR/commit and protected-ref status, workflow run/source identity, deployed URLs, downloaded package hash, actual checks, limits and remaining human/Store decisions. Assume Copy does not work in mobile preview. Stop for my review.
```
