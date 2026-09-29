# Evidence: 0.5.0 release candidate 1 (September 29, 2026)

These results come from 0.5.0 "Research tools" release candidate 1 on `claude/0.5.0`. The product source tested is commit `32993fd`; later commits changed only tests.

The build has:
- a foundation: the research data, backup format 3, identifiers, Insights counts and Ember light's crimson;
- four areas of work: capture (context snippets and page citations), reading (status, stars, link details and Insights), citation exports, and imports;
- the lead's integration fixes.

No ZIP was packaged. **Every check passed**, both without grants (on macOS, Windows and Linux) and after the owner's Allow clicks.

## What's new in 0.5.0

- **Context snippets:** the words around each link on its page, up to 400 characters, kept only where they are prose. A bare list of links, or a line of citations, gives none.
- **Page citations:** the citation tags a page publishes about itself, read from the page you capture from and from tabs you save as links.
  - Highwire, PRISM, JSON-LD and Dublin Core are read. Nothing is looked up online.
  - A saved tab is read only with site access Link Meteor already has, or the temporary access of the click that saves it.
- **Identifiers read from addresses:** DOI, arXiv, PubMed, PMC and ISBN (with check digits).
- **Reading status and stars:** set in link details and for the selection, with Undo, and used as view options.
- **Insights:** a collection's sites, file types, reading status, repeats and captures by week. Choosing an entry shows those links.
- **Citation exports:** BibTeX, RIS, CSL-JSON, an annotated bibliography and an Obsidian note. There are also new export columns: context, reading status, starred, DOI, arXiv ID, PubMed ID, ISBN and imported from.
- **Imports:**
  - sources: CSV, TSV, Excel, lists, HTML and bookmarks files, Link Meteor JSON exports, pasted links, and Chrome bookmark folders;
  - column mapping, including to new custom columns;
  - a preview that shows every skipped row and why;
  - Undo.
- **Ember light's Remove red** is now a crimson that no longer looks like its orange links.
- **Backup format 3**, which 0.4.0 refuses with an update message.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 217 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: research data, backup format 3, identifiers, Insights, page citations, the menus' tab reading, citation formats against golden files, and imports (CSV, TSV, lists, workbooks, every skip reason). |
| `access-browser` | 34/34 | [Results](access-browser-results.json). New: context and page citations saved through the real background; *Save tabs as links* reading nothing without site access, and This page's tab read with the toolbar's temporary access. |
| `access-content` | 50/50, simulation | [Results](access-content-results.json). New: every kind of context block, including lists of links, which give none; citation tags of each kind; and the 20,000-link timing. |
| `exports-browser` | 28/28 | [Results](exports-browser-results.json). New: every citation format downloaded equals the export code, and the new columns. |
| `backup-browser` | 22/22 | [Results](backup-browser-results.json). |
| `downloads-browser` | 9/9 | [Results](downloads-browser-results.json). |
| `reading-browser` (new) | 12/12 | [Results](reading-browser-results.json). Status and stars from the keyboard, with Undo; the view options; Insights against the counting code; choosing an entry; 320 px and contrast. |
| `imports-browser` (new) | 12/12 | [Results](imports-browser-results.json). Files through the file chooser, pasted links and a bookmark folder (Chrome's prompt stubbed), mapping, skips, Undo, 320 px and contrast. |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 15 checks, pass | [Results](visual-results.json). The new link details, badges and Insights in every theme and scheme, at 320 px, with contrast measured. |
| `site-check` | Pass | [Results](site-results.json). |
| The site/package sync | Skipped | No 0.5.0 ZIP yet. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `32993fd` (workflow run 36621768565), and all passed. An earlier run on the branch failed on Linux only: one contrast reading was taken during a color transition. The suite now waits for transitions to end.

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows, in two rounds of new profiles. Each request came from the product with an active user gesture.

- **Per-site profile, 5 prompts:** tabs, the fixture site, bookmarks, downloads, and a newly visited site through *Capture this page*. [Log](grants-site.log).
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks. [Log](grants-all.log).

### The first granted run found a product problem

The [first run](granted-run1/) failed `browser` and `extended-browser` at searches. A search for one paper found three links, because in a bare list of links each link's context was its neighbors' titles, and search includes context. `verify-downloads` then had no files to read.

The fix (`32993fd`) keeps context only where the words around a link are prose. It changed the build, so the owner allowed the prompts again in new profiles, and every suite ran again.

## Granted suites (second round; visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 10/10 | [Results](extended-browser-results.json). New: importing a real bookmark folder with its subfolder, then Undo. Every other bookmark was unchanged.<br>The [first attempt](logs/extended-browser-first-run.txt) failed only on the test's wording for a repeated bookmark ("Repeats link 1"; the preview says "Repeats row 1", like its Row column). The rerun used the profile's second granted site, since `permission-browser` had removed the first. |
| `site-browser` | Pass | [Results](site-browser-results.json). All eight practice answer keys. |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). |
| `downloads-granted` | 6/6 | [Results](downloads-granted-results.json). |
| `access-granted` | 11/11 | [Results](access-granted-results.json). New: with all-sites access, *Save tabs as links* reads five research tabs' citation tags into page citations, without any permission request. |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

These are automated Chrome for Testing checks. The owner's hands-on check comes next. It covers:
- real article pages;
- citations in Zotero and BibDesk;
- the Obsidian note;
- a real CSV or Excel import, and a bookmarks export;
- Insights;
- Ember light.
