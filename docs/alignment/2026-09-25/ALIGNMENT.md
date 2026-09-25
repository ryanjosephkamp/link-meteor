# Link Meteor: product and autonomous-build alignment

Date: September 25, 2026. Intended driver: GPT-6 Astra, Xhigh.

Status: written design and proposed operating agreement for review. The user has approved the product direction and requested final alignment before beginning. No implementation loop has started, no workers have been dispatched, and no Chrome extension has been built or tested. The next prompt embedded in the HTML report authorizes the first build iteration when the user chooses to send it.

## 1. What we are building

Link Meteor is a completely free Chrome extension for capturing, reviewing, organizing, and exporting links. Its first-release defaults favor research and collecting sources, while remaining useful for admin panels, ticket systems, and product lists.

The essential contract is faithful extraction of anchor text and URLs into separate fields. Capture should be quick; review and export should preserve where each link came from. All first-release features remain free, without accounts, subscriptions, advertisements, telemetry, or a hosted backend dependency.

The reference product informs functional requirements. Link Meteor will have independently written code, original branding, assets, wording, and interaction design. Additional features are not a substitute for originality or legal clearance. Name/IP clearance has not been established.

The public repository is https://github.com/ryanjosephkamp/link-meteor. Read-only inspection on September 25 found a public repository on main with only README.md. The working directory is /Users/noir/Documents/link-meteor; it was empty and was not a Git checkout before these planning files were written. Reverify both states at implementation start.

## 2. First-release scope

| Capability | Required outcome |
| --- | --- |
| Regional capture | Configurable shortcut to arm selection, click-and-drag rectangle, live matching-link highlights and count, Escape cancellation, scrolling during selection, and additional regions appended to the active collection. An optional hold-key-and-drag mode operates on sites with persistent permission. |
| Page and tab capture | Current page, selected open tabs, current window, and all ordinary windows in the current Chrome profile. Show scope before collecting. Show successes, denied access, unsupported pages, and errors separately. |
| Review | Separate anchor-text and URL columns; search; domain, file-type, and internal/external filters; sorting; row selection; removal and undo. |
| Collections | Named local collections, collection notes, tags, append operations, explicit deletion, and persistence across browser restarts. |
| Export | Real Excel .xlsx, CSV, clipboard, Markdown, HTML, JSON, and Chrome bookmark folders. Configurable exported columns and order. The default spreadsheet/clipboard output places anchor text and URL in separate columns. |
| Quick actions | Copy two columns, copy URLs, copy Markdown links, and open selected links in a bounded batch. Show the count before a large batch is opened. |
| Accessibility and resilience | Keyboard-accessible controls, visible focus, meaningful labels, light/dark presentation, reduced motion, useful empty/error states, and no collection loss when the extension's background worker restarts. |

“Specific pages” in this release means specific open tabs. Visiting pasted URLs, crawling sites, automatic pagination, automated continuous scrolling, and extracting the contents of PDFs are deferred. An ordinary link to a PDF remains a supported link.

Ordinary authenticated pages are eligible when the user can access them and grants the necessary permissions. This is not a promise to support every application or all content: browser-restricted pages, unloaded/virtualized items, inaccessible frames, and links represented only by opaque JavaScript controls need honest coverage reporting. Do not silently report an inaccessible page as a successful capture of zero links.

## 3. Data fidelity and research behavior

Every captured occurrence has a stable identity and keeps anchor text, resolved destination URL, original href where available, source page URL, source page title, capture time, capture/batch identity, and collection association separate. User notes and tags remain separate from extracted facts. The extension does not fetch destination pages merely to invent or enrich titles.

Anchor text means the visible textual label of the actual link, with a documented whitespace-normalization rule. For a link labeled “Download PDF,” that phrase remains anchor text. Accessible labels or image alt text can be recorded in a separate labeled field; a truly textless anchor has an empty anchor-text field. Destination page titles and inferred document names must never silently replace anchor text.

Retain link occurrences even when they share a destination. Deduplication is a reversible view/export choice with explicit modes, such as unique URL or unique URL plus anchor text. A unique-URL view must retain access to the differing labels and source pages. Preserve originals when any transformation is introduced.

Regional capture uses visible rendered link geometry, with deterministic handling of partial intersections and wrapped text. The implementation plan will specify that rule and test it. Whole-page extraction distinguishes links present in the loaded page from content never loaded. Establish and document frame and open-shadow-root support; make denied or unsupported coverage visible.

Exports must handle commas, quotes, line breaks, Unicode, and spreadsheet-like formulas safely. HTML/Markdown output must escape untrusted page content. Display extracted content as data rather than executable markup. Opening or bookmarking links must validate supported URL schemes.

Saved collections stay in extension-local storage. Any bookmark synchronization performed by the user's browser is separate from Link Meteor's local collection storage and should be explained accurately in privacy documentation.

## 4. Product experience and architecture direction

The proposed interaction has three surfaces: a quiet selection overlay and compact action strip; a side panel for review alongside the source page; and a full-width collection view for larger tables and exports. Copy, Add to collection, and Review are prominent actions. The initial visual direction is off-white/graphite with a warm meteor accent, light/dark support, and restrained motion. This is a provisional direction for a usable first build; Opus will have creative latitude later.

The Chrome build will use Manifest V3 with packaged local extension code. Separate the page capture layer, background coordination, data/storage model, review UI, and export adapters so they can be tested independently. Browser-specific calls should have modest boundaries that ease later ports, without building a speculative cross-browser framework now. Exact dependencies and file structure belong in the implementation plan.

Default activation uses current-page access when the user invokes the extension. The always-ready hold-key gesture and multi-tab operations require additional site access; request that access at the relevant feature and explain its purpose. Request bookmark access when needed. Do not request permissions merely for hypothetical future features.

## 5. Autonomous implementation and review loop

The driver remains GPT-6 Astra Xhigh, as selected by the user. Use bounded worker agents under this task for delegated implementation; the driver retains responsibility for integration, decisions, reviews, and the handback.

| Role | Default routing | Responsibility |
| --- | --- | --- |
| Driver/integrator | GPT-6 Astra Xhigh | Architecture, interfaces, scope decisions, difficult defects, integrated acceptance, and reconciliation of worker evidence. |
| Main implementation worker | GPT-6 Sol High | Substantial implementation with an explicit output and acceptance contract. Use Sol Xhigh when complexity warrants it. |
| Bounded support worker | GPT-6 Luna High or Xhigh | Well-specified, independently verifiable tasks such as fixtures, documentation, or a contained UI/export adjustment. Escalate when the task proves more complex. |

Start with one worker. Add a second only for a substantial independent unit with settled interfaces and disjoint file ownership. Use at most two workers concurrently in the initial iteration, plus Astra. Workers do not spawn additional workers. This is a resource-conscious routing proposal, not measured proof of lower cost or faster delivery.

Every dispatch names the model and effort, baseline, owned files, interfaces, intended result, acceptance checks, prohibited actions, and handback format. Record actual worker identities/settings from available tool metadata rather than inferring them from prose. If a requested model/effort cannot be dispatched, report that limitation rather than silently substituting an unapproved model.

Workers return changed files, behavior implemented, tests actually run, results, and known limitations. Astra examines the changes and validates the integrated result on the current code. Worker success is evidence to review, not automatic acceptance. Astra either accepts the result, makes a targeted fix, or sends a specific repair request to an existing or new worker. Repairs remain within the approved scope.

Prefer reusing a suitable worker with a bounded follow-up over repeatedly recreating context. Parallel work is optional, and the controller should wait efficiently when there is no useful integration work rather than perform busy polling. If repeated repairs make no progress, checkpoint the evidence and return a bounded decision instead of extending the same failed approach indefinitely.

## 6. Time, resources, and project boundaries

Each autonomous iteration starts its own recorded wall-clock timer when implementation is explicitly launched. Aim to finish sooner when the work is ready. Around 5.5 hours, avoid launching large new work and begin closeout planning. Near six hours, finish a short coherent step if necessary, checkpoint, and hand back; do not silently restart the clock or launch another six-hour iteration. This is a soft closeout window, not a target to consume.

The user has authorized broad routine autonomy for this project once the build begins: implementation, local testing, bounded worker delegation, repairs, and periodic GitHub backups. That does not authorize unrelated machine or account changes.

- Work in /Users/noir/Documents/link-meteor and task-owned paths beneath it. Preserve existing planning files when connecting this initially non-Git directory to the existing repository.
- Do not delete files outside that directory. Keep project dependencies, browser profiles, temporary outputs, and caches within it where configurable. Use ignored scratch directories and keep release evidence small.
- Do not terminate unrelated Codex tasks, Claude Code sessions, applications, browsers, or servers. Track task-created process/profile identities and stop only those. Never use broad process-kill commands.
- Reuse existing runtimes where suitable. Avoid global installs, VMs, containers, heavyweight emulators, unnecessary browser downloads, and unbounded traces. Check available disk and memory conditions before resource-heavy work; stop and report unexpected growth or pressure.
- Use one dedicated test-browser instance by default. Bound tab counts and stored screenshots/traces; retain failure evidence and concise milestone evidence rather than every intermediate run.
- Change only ryanjosephkamp/link-meteor on GitHub. Do not alter other repositories, visibility, account/security settings, or credentials. User sign-in, payment, and security decisions remain with the user.
- Firefox, Safari, AI integrations, the GitHub Pages implementation, and Opus execution are outside the initial Codex build loop. Do not schedule future background runs unless requested.

Actual time and available usage measurements may be reported. Do not present estimates as billing, attribute account-wide usage to this task, or promise that delegation will produce specific savings. If capacity runs out, preserve a usable checkpoint and handback.

## 7. GitHub checkpoints and recovery

At launch, verify the actual remote, branch, current files, and relevant repository instructions. Establish a dedicated implementation branch in this repository. Astra owns shared integration and remote pushes so workers do not race on Git state.

Commit at coherent milestones and push the branch periodically so work is saved remotely, including before each handback. Keep unfinished but recoverable work clearly labeled. Use a practical checkpoint cadence during long work rather than waiting until the entire product is finished. Exclude dependencies, browser profiles, caches, private browsing data, and bulky test output.

Verify push success and record branch names and commit hashes. If a push fails, keep the local commit, report the exact failure, and do not claim a remote backup exists. No force pushes or destructive history rewriting. A feature-branch checkpoint is not a Chrome Web Store release or owner approval. A PR may organize review; store publication remains an explicit later step.

At closeout, workers must have finished or been stopped from further writes before the final state is described. Capture what is committed, what is pushed, any remaining dirty files, and which task-owned processes remain. The next iteration resumes from those facts rather than redoing completed work.

## 8. Delivery sequence and acceptance

1. After the user approves this written alignment and launches the build, create the detailed implementation plan, task decomposition, and acceptance map. The embedded launch prompt explicitly authorizes Astra to execute that plan using the agreed worker loop without another routine permission exchange.
2. Build a complete regional-capture-to-review-to-export path and prove separate anchor-text/URL output before expanding breadth.
3. Add full first-release capture scopes, collection persistence, filters, formats, bookmarks, and accessible states.
4. Reconcile and test the complete extension, repair defects, and produce an installable development build with a clear manual-review guide.
5. Hand back to the user when the Chrome build is ready for their review, or at the six-hour closeout if work remains. Prepare the Opus package when there is a coherent, functionally checked baseline.
6. The user sends the package to Claude Opus 5.5 in Claude Code. Opus refines extension aesthetics/UI/UX and builds/designs the GitHub Pages site.
7. After the user returns the Opus result, Astra reviews the changes and audits final functionality. Only after that and user approval do we proceed toward Chrome Web Store publication.

The local test site will contain bibliographies, ticket tables, product cards, repeated URLs with different labels, relative links, image-only links, Unicode, wrapped anchors, dynamic content, nested scrolling, and frame/shadow-root fixtures. Fixtures define expected link identities and labels.

Acceptance includes the loaded extension's real capture/review/export path, selected-tab and multi-window scopes, permission denial and partial failure, meaningful zero-link states, persistence/restart behavior, export file contents, and representative large collections. Test spreadsheet strings and escaped HTML as well as normal links. Add accessibility and visual checks where they provide useful evidence.

Automated Chromium tests and visible Chrome checks are distinct. A mocked API, a static screenshot, or a successful unit test does not prove a native shortcut or permission prompt works in installed Chrome. Mark untested operating systems, actual Chrome interactions, native clipboard behavior, and real-site limitations plainly. Human acceptance remains the user's review.

Do not claim arbitrary link-count or performance guarantees before measurement. Any collection cap should be a transparent operational limit with partial progress and recovery, never a monetization limit or silent truncation.

## 9. Opus 5.5 handoff: context without over-prescription

Create the actual package from the tested baseline, not now from an imagined completed product. Include an orientation document; exact repository, branch, and commit; source and a small build artifact where useful; screenshots of implemented flows; the functional contract; known defects and tradeoffs; reproducible checks and evidence; original-branding context; and a clear return-to-Astra prompt. Include both an extension-refinement brief and a GitHub Pages brief with their different deliverables.

The Opus prompt will ask it to inspect the project and create its own working scaffolding before making changes. Opus chooses its planning structure, internal workflow/governance, tools, design process, and technical approach. Existing commands and architecture are context, not an instruction to retain a particular stack or Codex scaffolding. It may propose or implement appropriate refactoring while preserving the agreed functionality and project boundaries.

For the website, communicate the audience, free-forever positioning, install path, feature explanations, practice/demo page, documentation, privacy information, accessibility, and original assets. Leave the design and implementation to Opus. Do not build or deploy that website during the initial Codex extension loop.

Request a return summary explaining what changed, any behavior or permission changes, checks actually run, known limitations, and the final source location/commit. The user will initiate Claude Code work; Codex will not control or terminate existing Claude sessions. A polished appearance does not replace the final Astra functionality audit.

## 10. Later expansion, kept separate from version one

Firefox and Safari follow the locked-in Chrome version. Treat each as a separate port with current API, packaging, permission, distribution, and real-browser verification work; do not assume a manifest change alone proves compatibility.

Potential research improvements include surrounding-sentence/heading capture, collection comparisons, saved filters/export presets, reversible tracking-parameter cleaning, text-to-links extraction, verified DOI/arXiv metadata, and controlled continuous capture. These are backlog ideas, not automatic additions to the first iteration.

A promising future AI feature is a user-previewed source/prompt package: selected links, anchor text, source context, notes, stable source IDs, and a question or task brief exported as Markdown/JSON. It can be useful without calling an AI service. Later model integrations should be explicit opt-ins with clear data destinations and spend controls. Keep captured webpage text identified as untrusted source material rather than mixing it into the user's instructions. Do not send private/admin URLs or page contents to a provider by default.

No AI integration or destination-content fetching is authorized as part of version one. Preserve useful structured exports now, without inventing a large future plugin architecture.

## 11. Handback format and next action

Use the render-mobile-html-report skill for substantial handbacks. Provide standalone mobile-readable HTML first, canonical Markdown, exact next-prompt text embedded in the HTML, and relevant screenshots/build artifacts. Keep the full prompt readable without JavaScript. The user expects the mobile-preview Copy button not to work; do not spend time trying to repair that viewer limitation. A full-browser fallback may be stated, but actual Android clipboard/preview behavior must remain labeled untested unless demonstrated.

Each build handback states: completed behavior; current branch/commit and remote-backup status; checks executed and their outcomes; worker-only claims versus Astra-verified results; remaining issues; resource/time notes; and the single next action for the user. Use distinct statuses such as ready for manual review, incomplete at time limit, blocked, or ready for the Opus pass. “Tests passed” is not interchangeable with “user approved” or “published.”

This alignment package has only been prepared locally. It is not yet committed or pushed because the implementation/bootstrap loop has not been launched. The next prompt approves this written design and authorizes the first autonomous iteration. Alternatively, the user can request amendments before launching.

## 12. Reference context

These primary references were consulted during the initial product discussion. Recheck changing publication/API requirements during implementation and before release.

- [Reference product](https://link-grabber.com/): functional context only; do not copy its code, assets, or presentation.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) and [permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions): user-triggered current-page access and optional site permissions.
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions): dedicated persistent Chromium contexts; distinguish automated testing from installed Chrome acceptance.
- [Chrome developer registration](https://developer.chrome.com/docs/webstore/register) and [user-data disclosures](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): registration and local-data privacy requirements.
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): later public website hosting.
- [U.S. Copyright Office](https://www.copyright.gov/register/tx-programs.html) and [USPTO](https://www.uspto.gov/trademarks/search/likelihood-confusion): expression/function and trademark-confusion context, not legal clearance for Link Meteor.

## 13. Report validation limits

The HTML is rendered from this canonical Markdown and embeds NEXT_PROMPT.txt verbatim. The accompanying validation.json records executed structural/browser checks. A local report rendering check is not extension acceptance, an Android preview test, or a clipboard-success claim. No product screenshots or extension test results exist yet.
