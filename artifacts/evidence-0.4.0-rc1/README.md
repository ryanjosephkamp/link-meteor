# Evidence: 0.4.0 release candidate 1 (September 27–28, 2026)

These results come from 0.4.0 "Make it yours" release candidate 1 on `claude/0.4.0`, source commit `64c6449`. That build is:
- the foundation: settings, backup format 2, themes, and the card's colors as named roles;
- three areas of work: themes and appearance, the capture card, and workbench extras;
- the lead's integration fixes.

No ZIP was packaged. **Every check passed**, both without grants (on macOS, Windows and Linux) and after the owner's Allow clicks.

## What's new in 0.4.0

- **Themes:** seven themes (Meteor, Comet, Aurora, Ember, Nebula, Graphite, High contrast), each light and dark, and an Appearance setting (System, Light or Dark). The side panel, full view, on-page card, selection highlight and toolbar icon all follow the theme, and the website has a theme menu.
- **After a drag:** show the card, copy right away, or add right away with Undo.
- **Leave out navigation links:** links in page-level headers and footers, navigation and sidebars start unticked, and the card says how many. *Capture this page* leaves them out and offers *Include them*.
- **Card filters:** All, Other sites, PDFs and Same site.
- **Already saved:** matching links are marked, with *Skip saved*.
- **Copy as rich links:** on the card and in the Export panel.
- **Copy diagnostics:** in About and help. It never includes addresses, site names, titles, notes, tags or collection names.

## Checks without optional grants

Headless Chrome for Testing 151 in fresh task-owned profiles, run with `npm run check`. The [summary](summary.md) links every log.

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests | 120 pass, 1 skipped | [Log](logs/unit.txt). The skip is the current-ZIP check. New: themes (completeness, Meteor parity, 4.5:1 text contrast, and color-vision simulations), card handlers, diagnostics privacy, and backup format 2. |
| `access-browser` | 26/26 | [Results](access-browser-results.json). New: saved, skipped and Undo through the real background; the rich-copy payload from the real clipboard; content-only on *Capture this page*; and a theme change restyling an already open card without a reload. |
| `access-content` | 35/35, simulation | [Results](access-content-results.json). Every After a drag mode and its notice, content-only, filters, already saved and rich copy. A post's own header and footer links stay ticked. |
| `exports-browser` | 16/16 | [Results](exports-browser-results.json). Rich links (exact HTML and text), Copy diagnostics (no addresses or names), and themed website links. |
| `backup-browser` | 19/19 | [Results](backup-browser-results.json). Backup format 2; the restore preview names the new settings. |
| `capture-page-access` | Pass | [Results](capture-page-access.json). |
| Audits: overlay, actions, regressions | 4, 9 and 7 checks, pass | [Overlay](audit-overlay.json), [actions](audit-actions.json), [regressions](audit-regressions.json). |
| `visual-browser` | 14 checks, pass | [Results](visual-results.json). For every theme in light and dark: measured contrast, no overflow at 320 px, and a side-panel screenshot (`panel-theme-*.png`). The toolbar icon's pixels are in [`toolbar-icons.png`](toolbar-icons.png). |
| `site-check` | Pass | [Results](site-results.json). Every theme in both schemes on the home page (`site-theme-*.png`), and the theme menu by keyboard. |
| The site/package sync | Skipped | No 0.4.0 ZIP yet. |

**On macOS, Windows and Linux**, GitHub's runners ran the same checks on `64c6449` (workflow run 36356259117), and all passed. Earlier runs on the branch found only test-harness differences, now fixed:
- Windows stores clipboard text with CRLF line endings, so the tests now normalize them;
- one test's markup needed updating after the page-chrome rule was narrowed.

## Allow clicks

The project owner clicked Allow on every native prompt, in visible Chrome for Testing windows. Each request came from the product with an active user gesture.

- **Per-site profile, 4 prompts:** tabs, the fixture site, bookmarks, and a newly visited site through *Capture this page*. [Log](grants-site-profile.log).
- **All-sites profile, 5 prompts:** tabs, the fixture site, all sites from the welcome card, tab groups and bookmarks. [Log](grants-all-sites-profile.log).

## Granted suites (visible windows, pointer parked by the owner)

| Check | Result | Notes |
| --- | --- | --- |
| `browser` | 27/27 | [Results](browser-results.json). Its workbench screenshots are in [`browser-screens/`](browser-screens/). |
| `extended-browser` | 9/9 | [Results](extended-browser-results.json). |
| `site-browser` | Pass | [Results](site-browser-results.json). All eight practice answer keys (7, 9, 10, 12, 7, 15, 3, 5), and 95 links for the whole page. |
| `audit-granted-regressions` | 4/4 | [Results](granted-regressions.json). |
| `verify-downloads.py` | Pass | [Results](workbook-results.json). openpyxl 3.0.10, not Microsoft Excel. 53 exact rows. |
| `access-granted` | 10/10 | [Results](access-granted-results.json). |
| `permission-browser` | 10/10, run last | [Results](permission-browser-results.json). |

These are automated Chrome for Testing checks. The owner's hands-on check in everyday Chrome comes next. Its checklist covers:
- every theme in light and dark on real pages;
- the new card behaviors;
- rich paste into Google Docs and Word;
- Copy diagnostics.
