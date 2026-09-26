# Link Meteor → Opus: demo and tutorial videos

Prepared September 25, 2026 for Claude Opus 5.5 in Claude Code.

[Open the plain-text Opus prompt](OPUS_PROMPT.txt).

**Paste the exact prompt at the end into your existing Opus session.** It asks Opus to create playable demo/tutorial videos and integrate them into a local preview of the website. Remotion is optional. Opus chooses its tools, scaffolding, creative approach, music or silence, narration, format, length and number of videos.

You can continue with Opus afterward. Returning to Astra is optional, for debugging or independent testing when useful. This package prepares that transition; no videos have been created and Claude Code has not been launched by Astra.

## Your current installation

You said you have **not manually updated your everyday installation or performed the proposed 0.2.1 manual checks**. Your installed copy remains 0.2.0 in `artifacts/link-meteor-0.2.0/`. That folder, personal Chrome profile and private collections remain untouched. Opus can record the audited 0.2.1 build in an isolated task profile without waiting for your manual update.

The development ZIP is the primary distribution route: download, extract, enable Chrome Developer mode and load the extracted extension folder. Chrome Web Store and other browser stores remain deferred. All features remain free.

## Refresh the old Opus session first

The original Opus design handback predates Astra's audit repairs and the completed publication. Opus should read this package before switching branches, then start its media work on a new branch from current `main`. It chooses the branch name and working method. These handoff documents live on `codex/audit-0.2.0`; they are not in the deployed main snapshot.

| Item | Verified state for this handoff |
| --- | --- |
| Website | [Live Link Meteor site](https://ryanjosephkamp.github.io/link-meteor/) |
| Integrated main | `ee3148ec584c51e49438bed097ffb70c9d9a6603` |
| Release snapshot | `696620091f7a92d3814e390582942c5f5db926b7` |
| Product source | `e8e69cf734ed750ee6b792cc3cae1f9bf898ce62` |
| Build | [link-meteor-0.2.1.zip](../../../artifacts/link-meteor-0.2.1.zip), 193346 bytes |
| ZIP SHA-256 | `231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9` |
| Integration | [PR #2](https://github.com/ryanjosephkamp/link-meteor/pull/2) merged; [PR #1](https://github.com/ryanjosephkamp/link-meteor/pull/1) became indirectly merged |
| Publication | [Run 36196516959](https://github.com/ryanjosephkamp/link-meteor/actions/runs/36196516959), successful historical deployment |
| Evidence checkout at entry | `codex/audit-0.2.0` at `3311a0ee580e59108fced995836d7381279a830c`; this package is added afterward |

The [verification receipt](VERIFICATION.json) records the protected references. All 13 packaged files were rechecked against current source and the build receipt; the 13 files in the protected 0.2.0 installation remain unchanged. Current product, site and workflow match integrated main.

Some older status paragraphs in the repository README, acceptance document, original Opus handoff and site README still describe an undeployed site or earlier pending decisions. For publication status, the [completed publication report](../../publication/2026-09-25/REPORT.md) supersedes them. Their functional specifications and historical evidence remain useful.

## Creative brief and finished result

Make the real product easy to understand through appealing demonstrations and practical tutorials. A quick demonstration and getting-started guidance are useful starting points; Opus can combine, split or reshape them. The desired result is playable media, editable production sources and a working local website integration—not just a storyboard.

The core story is collecting research links while preserving their separate anchor text, URL and source. Regional drag capture, collections, review/filtering and exports provide concrete material. Installation guidance should follow the ZIP route. Use synthetic practice content so no personal information appears.

Animations, illustrations and reconstructed scenes are welcome. Production notes should identify them, and tutorials must show reproducible controls and outcomes. Do not depict a fabricated feature, permission interaction, performance result or missing citation metadata as real. Make the experience useful without sound, with readable captions/transcripts and accessible playback controls as appropriate. Choose distributable music/assets and preserve credits. Keep downloads modest and retain the site's privacy promises.

## References and reusable material

All paths below are inside this project. Existing assets and test infrastructure are useful inputs, not a requirement to reuse their technology or production method.

| Purpose | Starting points |
| --- | --- |
| Product and visual identity | [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), [brand assets](../../../assets/brand/README.md) |
| Binding behavior and data | [Approved alignment](../../alignment/2026-09-25/ALIGNMENT.md), [CONTRACTS.md](../../CONTRACTS.md), [PRIVACY.md](../../PRIVACY.md) |
| Website source and structure | [site/README.md](../../../site/README.md), `site/`, `site/assets/img/`, `site/assets/fonts/` and their license files |
| Safe demonstration content | [Practice page source](../../../site/practice.html), [live practice page](https://ryanjosephkamp.github.io/link-meteor/practice.html), [deterministic test fixture](../../../tests/fixtures/index.html) |
| Actual extension screenshots | [Selection overlay](../../../artifacts/audit-0.2.0/resume-01/site-overlay-card.png), [workbench](../../../artifacts/audit-0.2.0/resume-01/workbench-desktop.png), [capture report](../../../artifacts/audit-0.2.0/resume-01/site-report.png) |
| Published website screenshots | [Desktop home](../../../artifacts/publication/2026-09-25/site-home.png), [mobile home](../../../artifacts/publication/2026-09-25/site-home-mobile.png), [installation](../../../artifacts/publication/2026-09-25/site-install.png) |
| Functional and publication evidence | [ACCEPTANCE.md](../../ACCEPTANCE.md), [completed automated audit](../../audit-0.2.0/resume-01/REPORT.md), [publication report](../../publication/2026-09-25/REPORT.md) |
| Build receipt | [Per-file hashes](../../../artifacts/link-meteor-0.2.1.sha256.json) |

The site's existing side-panel illustration is a composite, not evidence of a native Chrome side-panel frame. `tests/design-preview.mjs` and `tests/overlay-preview.mjs` are simulations. Existing screenshots are references; fresh recordings should use the actual 0.2.1 package and a task-owned profile.

## What has and has not been accepted

Historical 0.2.1 evidence includes automated Chrome for Testing capture, collections, exports, persistence, grant-dependent behavior and revocation checks; downloaded exports were independently read. The deployment audit separately checked the published site, its layouts/assets and matching ZIP. Those reports identify the tested environment and exact counts.

Automated grants do not establish an observed native Allow/Deny interaction. Your earlier 0.2.0 report of successful use was not an itemized test. Native panel behavior, screen-reader acceptance, real-phone use, manual 0.2.1 acceptance and untested browser/OS combinations must not be claimed from those results.

This handoff preparation reverified Git/remote/publication state, source/package consistency and protected files. It does not add new extension acceptance. Its own HTML layout checks are recorded separately in [VALIDATION.json](VALIDATION.json); timing and preservation are in [CLOSEOUT.json](CLOSEOUT.json).

For new site/media work, run checks proportional to the change. Existing product commands include `npm test` and `node scripts/sync-site.mjs --check`; the site checker and browser tests can support integration review. Do not overwrite earlier evidence or use a personal browser as a fixture. Permission tests can revoke access, so old test profiles are not automatically ready for filming. No unchanged extension rebuild is needed for video additions.

## Ownership and publication

Opus can implement, test, commit and push the media/site work. This prompt stops before merging or deploying those additions. You can authorize publication directly with Opus after reviewing its result; there is no mandatory Astra gate. The previous one-shot Pages deployment authorization is already spent.

Preserve the original design/audit history, branches and tag. Do not change product behavior, permissions or schema to simplify filming. Keep work in this repository, protect unrelated sessions/processes, and keep caches/renders bounded: the last disk check was 96% full, with about 16.8 GiB available. No Store work, payments, account/security changes, ports or AI work is included.

## If you return to Astra later

The [optional return-to-Astra prompt](RETURN_TO_ASTRA.txt) is ready for future debugging or independent testing. Opus should supply its actual final branch/commit, changed files, video/source artifacts, tests and reproduction steps. Astra will refresh the then-current project rather than assume today's deployment or permissions still apply.

## Exact prompt for Opus

The full prompt below is also in [OPUS_PROMPT.txt](OPUS_PROMPT.txt). It remains readable without Copy; mobile-preview copying has not been investigated.

```text
You are Claude Opus 5.5 in Claude Code. I am handing Link Meteor back to you to create polished, useful demo/tutorial videos and integrate them into its website. This can continue our existing session, but refresh from the actual current project before relying on the earlier design context. I may continue working with you afterward; returning to Astra is optional and will probably be for debugging or independent computer-use testing.

Work only in /Users/noir/Documents/link-meteor and https://github.com/ryanjosephkamp/link-meteor. Start by reading docs/opus-video-handoff/2026-09-25/REPORT.md and VERIFICATION.json, the publication handback in docs/publication/2026-09-25/, docs/ACCEPTANCE.md, the approved docs/alignment/2026-09-25/ALIGNMENT.md, docs/CONTRACTS.md, docs/PRODUCT.md, docs/DESIGN.md and docs/PRIVACY.md. Reinspect files, repository instructions, Git status and remote; preserve intervening work. Inspect the project and create your own scaffolding before beginning. Choose your own technology, tools, working structure and creative process; existing code and documents are context, not a mandated stack or governance template.

Current reality: the website is live at https://ryanjosephkamp.github.io/link-meteor/. Main is ee3148ec584c51e49438bed097ffb70c9d9a6603, integrated through PR #2; PR #1 became indirectly merged. The audited 0.2.1 build includes fixes made after your original claude/design-v1 handback. Its ZIP is artifacts/link-meteor-0.2.1.zip, 193346 bytes, SHA-256 231f454f60a7aba45ad6834b559268e1ddaabc66304ce55be4a9e783a7d219e9, packaged from product source e8e69cf734ed750ee6b792cc3cae1f9bf898ce62. The release snapshot is 696620091f7a92d3814e390582942c5f5db926b7. Publication run 36196516959 succeeded. The audit branch at 3311a0ee580e59108fced995836d7381279a830c contains the publication evidence; later documentation commits contain this handoff. Older README/acceptance/Opus-handoff statements that the site is undeployed or that 0.2.0 is current are historical. Refresh the facts and do not revert to the old design branch.

Use a new branch from the current main for this media/site work, choosing its name and your own working method. Read/carry this handoff before switching: these new handoff documents live on codex/audit-0.2.0, not the deployed main snapshot. Do not rewrite the audit/design history, remove the original branches or move opus-handback-2026-09-25.

Creative brief: make the product easy to understand and appealing through a coherent set of demo/tutorial videos, with sensible placement in the website. Remotion is welcome if suitable, but not required. Choose the number of pieces, duration, pacing, tone, music or silence, narration or text, animation language, aspect ratios and rendering approach yourself. A product demonstration and practical getting-started guidance would be useful; combine or split them as you judge best. Build on the identity you designed while giving the medium appropriate creative treatment. Do not stop at a storyboard: deliver playable videos and a working local site integration for my review.

Ground the important interactions in the real audited 0.2.1 product, using synthetic practice/fixture content and a task-owned browser/profile. Useful material includes regional drag capture, separate anchor text and URL columns, source provenance, collections, review/filtering and export. Download ZIP → extract → Developer mode → Load unpacked is the primary installation route. Show only workflows, controls, counts and outcomes you can substantiate. Animation, reconstruction, callouts and editorial cuts are fine, but keep tutorials reproducible and record what is a real recording, a reconstruction or an illustration. Do not portray simulated Chrome permission sheets or reconstructed side-panel frames as native evidence. Do not fabricate anchor text, citation metadata, features, speed claims or human test results.

The user-facing contract stays intact: faithful separate anchor text/URL/provenance; meaningful empty anchor text; retained original occurrences and reversible grouping; local schema-v1 collections; honest denied/unsupported/partial results; existing permission timing; all features free, no accounts, ads, telemetry, backend dependency or paid tier. Website media must preserve the privacy promise and accessibility: useful controls, readable captions/transcripts as appropriate, a usable silent experience, no forced audio, and reasonable loading/download sizes. Use assets/music you have rights to redistribute and retain their provenance/credits. Prefer a self-contained site experience rather than adding tracking or third-party media dependencies. These are outcomes; choose the implementation yourself.

I am currently remote on my phone. I have NOT manually updated my installed extension and have NOT done the proposed 0.2.1 manual acceptance. My everyday installation is still the protected artifacts/link-meteor-0.2.0/ folder. Do not write, overwrite, move or delete that folder, operate my personal Chrome profile, or use my private collections in recordings. Do not make my manual update a prerequisite for producing the videos. Use an isolated copy of the verified package for filming/testing. If a real test-profile permission prompt blocks essential recording, report it and continue independent production work; do not forge grants or weaken security. Successful automated grants do not establish a human Allow/Deny observation.

Browser stores are deferred by my choice. Do not prepare store submissions, upload packages, register accounts, request credentials, make payments, alter account/security settings, start ports/AI features or schedule future work. Preserve unrelated apps, processes, Codex/Claude sessions and all other repositories; delete nothing outside this project. Check available disk before rendering—the drive was recently near full. Keep dependencies, caches, profiles and renders project-local where configurable; reuse installed tools, avoid heavyweight downloads/unbounded renders, and keep resource use modest. Commit and push coherent checkpoints to your working branch without force-pushing. Do not change the extension merely to make a video look better, and do not repackage unchanged code.

Integrate and test the media locally, but do not merge into main, dispatch Pages or change the live site under this prompt. The previous one-deployment authorization is spent; I can authorize publishing your reviewed changes directly in this Claude session later. Do not impose a mandatory return-to-Astra gate.

Hand back the playable files, editable production sources, local site preview/integration, credits, concise reproduction instructions, actual source/commit/package identities, tests run, production choices and known limitations. Clearly separate recordings/illustrations, automated browser checks and my still-unperformed manual acceptance. Preserve the truthful feature/testing claims and ZIP download. Include a readable mobile HTML report and canonical notes with a useful next prompt. If I later return to Astra, use the return brief in this handoff as context and give it the actual final branch/commit, changed files, artifacts and any failure reproduction steps. Begin the work autonomously within these boundaries; ask me only about a genuine blocker or a decision that cannot reasonably be resolved from the project and this brief.
```
