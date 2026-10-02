# Link Meteor

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/brand/readme-meteor.png">
  <img src="assets/brand/readme-meteor.gif?motion=2" alt="Link Meteor — a luminous lime meteor on a dark background">
</picture>

[View the animation](https://raw.githubusercontent.com/ryanjosephkamp/link-meteor/main/assets/brand/readme-meteor.gif?motion=2) · [View the still artwork](assets/brand/readme-meteor.png)

[Website](https://ryanjosephkamp.github.io/link-meteor/) · [Installation guide](https://ryanjosephkamp.github.io/link-meteor/install.html) · [Report a bug or suggest a feature](https://github.com/ryanjosephkamp/link-meteor/issues)

Capture the trail. Keep the source.

Link Meteor is a free Chrome extension for collecting links with their **actual anchor text and URL in separate fields**, reviewing their sources, and exporting a useful research collection. It has no account, ads, telemetry, paid tier, or backend dependency.

This repository contains the Chrome extension (development build 0.5.0) and its [live website](https://ryanjosephkamp.github.io/link-meteor/). Install the extension from the downloadable ZIP using Chrome's **Load unpacked** option. Chrome Web Store submission is planned for a later version. See [testing and compatibility](docs/ACCEPTANCE.md) for the environments and workflows checked so far, and the [changelog](CHANGELOG.md) for what changed.

## Try the development build

1. [Download version 0.5.0](https://ryanjosephkamp.github.io/link-meteor/downloads/link-meteor-0.5.0.zip) and extract it to a folder you will keep. The ZIP is a development package, not a store installer.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Open an ordinary webpage (try the [practice page](https://ryanjosephkamp.github.io/link-meteor/practice.html)). Use the extension toolbar action for the side panel, or **Option+Shift+L** on Mac / **Alt+Shift+L** on Windows and Linux to select a region. The side panel's welcome card offers **Allow on all sites (recommended)**, so you can hold a key and drag on any site, or **Choose sites later**.
5. Drag across links, then choose **Copy text + URL**, **Add to collection**, **Review**, or **Add another region**. The card's **Adds to** line names the collection the links will go to, and its menu can also open, copy, download or bookmark them, or download the files behind them. Escape cancels selection. You can scroll while dragging, and the highlights stay on their links. **After a drag** in the settings can copy or add right away instead of showing the card. Right-click a link, a selection, the page or the toolbar icon for more Link Meteor actions.

Chrome manages shortcut assignments at `chrome://extensions/shortcuts`. A shortcut can conflict with another extension or system shortcut; use **Change shortcut** in Link Meteor to inspect it. Reload the extension at `chrome://extensions` after rebuilding, then reload test webpages so their injected script is current.

For an existing installation, keep the same installation folder path and follow the [update instructions](https://ryanjosephkamp.github.io/link-meteor/install.html). Loading a different unpacked path can create a separate extension with separate storage. Since 0.3.0, **Download a backup** saves every collection and setting to one file, and **Restore from a backup** brings it back on this or another computer, merged or replacing, with Undo. Earlier versions have no restore, so export anything you want to keep before updating from them. A 0.5.0 backup uses a newer format that 0.4.0 and earlier can't restore.

## What is included

- Region, current-page, selected-open-tab, current-window and all-ordinary-window capture within the current Chrome profile, or saving the tabs themselves as links.
- A capture card with filters (All, Other sites, PDFs, Same site), links already saved marked and optionally skipped, and navigation links left out on request. **After a drag** can show the card, copy right away or add right away with Undo.
- Optional hold-key drag: hold a letter (Z by default), or Command on a Mac and Ctrl elsewhere, and drag. One optional choice allows it on all sites, with a **Never on these sites** list; otherwise it is enabled one site at a time.
- Named local collections with collection notes/tags and per-occurrence notes/tags, plus up to 20 custom columns per collection that you name and fill in, which search, exports and backups include.
- Search, domain/file-type/internal/external filters, sorting, row selection, removal and one-step undo. **Move to…** and **Copy to…** send links to another collection, with one Undo for both.
- Research details for each link: the words around it on its page, a DOI, arXiv ID, PubMed ID or ISBN read from its address, and the citation tags that pages publish about themselves. A link to a PDF uses the citation of a saved page about the same work. Nothing is looked up online.
- Reading status (Unread, Reading, Read) and stars, with view options for both, and **Insights**: a collection's sites, file types, reading status, repeats and captures by week.
- **Import links** from CSV, TSV, Excel, lists, HTML and bookmarks files, Link Meteor JSON, pasted text or a Chrome bookmark folder, with column mapping, a preview of skipped rows and Undo.
- Reversible unique-URL and unique-URL-plus-anchor views. Originals and different labels/sources remain stored; expand a group to inspect them.
- Real `.xlsx`, CSV, TSV, Markdown, HTML, JSON and URL-list downloads, and citation formats (BibTeX, RIS, CSL-JSON, an annotated bibliography and an Obsidian note), named after the collection and the date and time by default. Excel workbooks have a bold frozen header, filters, clickable links and an About sheet. Clipboard columns/URLs/Markdown; new or existing bookmark folders, skipping links already there; opening up to 500 HTTP(S) URLs in tabs, a new window or a tab group, with a confirmation above 20.
- Backup and restore of every collection and setting, with a preview, merge or replace, and Undo.
- Copy as rich links (clickable anchor text for Google Docs, Word or Notion), and downloading the files behind links, such as PDFs and images, into `Downloads/Link Meteor/<collection>/` with optional download access.
- Right-click actions on links, selections and pages, and a menu on the toolbar icon: add or copy one link, capture a selection's links, save tabs as links, or download a linked file.
- Ordered export columns. With no selection, exports include the entire filtered view across pages. When selection exists, exports use selected occurrences that still match the filters. JSON preserves every occurrence in each exported group. Other grouped exports use the displayed representative.
- Side panel (compact views for links, collections and site settings, and export, with a bottom dock showing the exact export target) and full workbench (three columns, with anchor text, URL and source as separate columns), seven color themes in light and dark that also color the capture card and toolbar icon, keyboard controls, visible focus and reduced-motion styling. The design system is documented in `docs/DESIGN.md`.
- An **About and help** area in the side panel and full view (the **?** button opens it): the version, the creator credit, the guide, bug reports and suggestions, the website, the source code and optional sponsorship. Its links open in a new tab only when you choose them; nothing opens or is sent automatically. **Copy diagnostics** there copies versions, settings, permission choices and counts for a bug report, never addresses or names.

## Fidelity and coverage

Anchor text is the rendered textual label with whitespace runs collapsed to one space and surrounding whitespace trimmed. Image alt text and accessible labels are separate fields. Empty anchor text stays empty, including in Markdown. Link Meteor never fetches a destination to invent a title or citation: citation details come only from tags that the pages you had open published about themselves, and from identifiers in addresses.

Each occurrence stores resolved URL, original href, source URL/title, frame URL, timestamp and batch ID. Repeated URLs are separate occurrences until you choose a grouped view. Captured `mailto:` and `tel:` URLs can be exported; batch opening/bookmarking is limited to HTTP(S). A textless bookmark uses the URL as its browser bookmark title without changing the saved anchor-text field.

A region selects a link when at least one visible, clipped client rectangle intersects it with positive area. Wrapped inline anchors have several rectangles. Scrolling accumulates links swept through the selected area. The visual highlight is limited to 250 matches to keep the overlay light; the selected count still includes all matched links up to the capture limit.

Capture covers loaded links, shadow roots (closed ones too) and the frames the page itself can read; *Capture this page* also reads frames from other sites that Link Meteor has access to, and names the sites of the frames it couldn't read. By itself it does not scroll, follow pagination or visit destinations. From 0.6.0 you can start three bounded captures, each with a counter, Stop and a stated limit: scroll a page to its end, follow its Next link for up to 20 pages, or capture the pages behind up to 20 selected links. It reads the links inside PDFs, from a tab or a file. It never crawls: links it finds are saved, not followed. It does not decode opaque JavaScript buttons. Chrome-internal pages, the Chrome Web Store and incognito are unsupported. Per-tab results distinguish success, a genuine empty page, denied access, unsupported pages and errors.

Operational limits are 20,000 links per page/region, 100 tabs per capture, and 500 links per opening action (with a confirmation above 20). Large captures show partial-coverage warnings rather than silently truncating. Collections use Chrome's local storage quota; failed writes preserve the previously saved data and show a recovery message. Review renders 100 rows per page and loads grouped details in increments of 100. These are resource bounds, never payment gates.

CSV/TSV prefix formula-like strings with an apostrophe for safer spreadsheet import. The original string remains intact in local data, JSON and the string-typed XLSX cells. HTML and Markdown escape page-supplied text. Exported files contain your selected URLs and notes; choose their recipients deliberately.

## Develop and verify

Building from source requires Node.js 22 or newer. There are no package dependencies to install. Load the resulting `dist` folder with Chrome's **Load unpacked** option.

```sh
npm run build
npm test
npm run check -- .scratch/check   # every check that needs no grants, with results in that folder
npm run debug                     # the extension in a fresh profile, streaming its background console and errors
npm run package
```

[`AGENTS.md`](AGENTS.md) is the working guide for people and coding agents: the code map, which tests need a person's Allow clicks, test settings, rules and common failures. The same checks without grants run on macOS, Windows and Linux for every pull request (`.github/workflows/check.yml`).

The build copies only packaged extension files. Packaging refuses stale source/build differences and emits a deterministic ZIP plus file hashes and truthful Git identity/dirty flags.

Browser tests reuse an installed Playwright library and Chromium/Chrome for Testing. No browser or library is downloaded by these scripts. Set `LINK_METEOR_PLAYWRIGHT` to an installed Playwright module if it is not on the normal Node resolution path. Set `LINK_METEOR_CHROME_PATH` to another Chrome for Testing executable, such as 116, to run the suites there.

```sh
# One isolated test browser; allow synthetic 127.0.0.1 access and bookmarks when requested.
node tests/interactive.mjs
# Press Return in that terminal to close only the test browser/server.
node tests/browser.mjs
node tests/extended-browser.mjs
node tests/site-browser.mjs        # practice-page answer keys and site screenshots
node tests/permission-browser.mjs  # run last: revokes the synthetic grant
node tests/capture-page-access.mjs # Capture this page after the tab moves to a new site (fresh temporary profile)
# Suites that need no grants (fresh task-owned profiles):
node tests/access-browser.mjs      # welcome card, Site access, the capture card through Chrome's toolbar action
node tests/access-content.mjs      # the page script with a stubbed chrome object (a simulation)
node tests/exports-browser.mjs     # export names, the formatted workbook, bookmark folder controls
node tests/backup-browser.mjs      # backup, restore with Undo, removing all
node tests/downloads-browser.mjs   # Download files with Chrome's prompt stubbed; nothing downloads
```

For a changed build, create a new isolated profile and prepare its grants through the product's own permission paths with `LINK_METEOR_TEST_PROFILE=<new-name> node tests/prepare-grants.mjs` (a visible test browser). `LINK_METEOR_GRANTS=all-sites` prepares the all-sites profile that `tests/access-granted.mjs` uses; run it before `tests/permission-browser.mjs`. `tests/downloads-granted.mjs` runs in the per-site profile and keeps every file under `.scratch/`. `node tests/visual-browser.mjs` needs no grants (`LINK_METEOR_VISUAL_PROFILE` picks its profile). `tests/design-preview.mjs` and `tests/overlay-preview.mjs` render the UI with simulated extension APIs for design iteration only; they are not acceptance evidence.

Tests store isolated profiles and cache under `.scratch/acceptance-final`, bind the local synthetic fixture server to `127.0.0.1:52478`, and fail if that port is occupied. `LINK_METEOR_TEST_PROFILE` and `LINK_METEOR_FIXTURE_PORT` can change these isolated resources. The browser suite **resets collections in its selected test profile**, so never point it at a personal browser profile. Prepare permission grants through the extension in the isolated browser. The harness records a build fingerprint and refuses reuse after packaged bytes change; prepare a fresh named test profile for a changed build. Headless optional-permission behavior was not accepted as native evidence.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` independently check OOXML and, when available, openpyxl parsing. See `docs/ACCEPTANCE.md` for current executed results, commands, native checks and limits. The declared Chrome minimum, 116, passed the checks that need no grants in Chrome for Testing 116, except the toolbar-button checks, which the test tool can't run there; the granted checks were not run on 116. The owner checked two test builds of 0.5.0 by hand in everyday Chrome on macOS, as they did 0.4.0, and 0.3.0 in Brave and Microsoft Edge as well. Other operating systems, other Chromium browsers and screen-reader use still need human review.

## Website

`site/` is a static GitHub Pages site (home with an interactive demo, a short video and a live export preview, install with a video walkthrough, guide, privacy, about and contact, and a practice page with verified answer keys). It makes no third-party requests and self-hosts its fonts. Visit [Link Meteor](https://ryanjosephkamp.github.io/link-meteor/). See `site/README.md` for structure, checks and the manual deployment steps; `.github/workflows/pages.yml` runs only when triggered by hand.

```sh
node scripts/sync-site.mjs          # copy the packaged ZIP, export modules and icons into site/
node scripts/sync-site.mjs --check  # verify the site matches the build
node tests/site-check.mjs           # pages × widths × themes, links, structure, contrast, demo, videos
```

The two silent site videos are made from recordings of the development build on the practice page. `media/` holds their recording scripts, timelines and compositor, and [`media/README.md`](media/README.md) explains how each scene was made, how to reproduce them and their limits.

## Privacy

Read [the privacy explanation](docs/PRIVACY.md), [product overview](docs/PRODUCT.md), [scope and guarantees](docs/SCOPE.md) and [data contracts](docs/CONTRACTS.md). Link collection and export processing happen locally in your browser.

## Support and suggestions

[Open a GitHub issue](https://github.com/ryanjosephkamp/link-meteor/issues) to report a bug or suggest an improvement. For a bug, include your extension version, Chrome version, operating system and steps to reproduce. Use a synthetic example where possible and leave private URLs, personal collection data and credentials out of public reports.

## License and author

MIT licensed; see [LICENSE](LICENSE). The site's Atkinson Hyperlegible Next and Mono fonts retain their SIL Open Font License notices in `site/assets/fonts/`.

Created by **[Ryan Kamp](https://github.com/ryanjosephkamp/)**. Link Meteor and all its features are free. Optional support never unlocks features or changes functionality.
