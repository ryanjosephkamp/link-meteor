# Link Meteor

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/brand/readme-meteor.png">
  <img src="assets/brand/readme-meteor.gif" alt="Link Meteor — a luminous lime meteor on a dark background">
</picture>

[View the still artwork](assets/brand/readme-meteor.png)

[Website](https://ryanjosephkamp.github.io/link-meteor/) · [Installation guide](https://ryanjosephkamp.github.io/link-meteor/install.html) · [Report a bug or suggest a feature](https://github.com/ryanjosephkamp/link-meteor/issues)

Capture the trail. Keep the source.

Link Meteor is a free Chrome extension for collecting links with their **actual anchor text and URL in separate fields**, reviewing their sources, and exporting a useful research collection. It has no account, ads, telemetry, paid tier, or backend dependency.

This repository contains the Chrome extension (development build 0.2.1) and its [live website](https://ryanjosephkamp.github.io/link-meteor/). Install the extension from the downloadable ZIP using Chrome's **Load unpacked** option. Browser-store distribution is deferred. See [testing and compatibility](docs/ACCEPTANCE.md) for the environments and workflows checked so far.

## Try the development build

1. [Download version 0.2.1](https://ryanjosephkamp.github.io/link-meteor/downloads/link-meteor-0.2.1.zip) and extract it to a folder you will keep. The ZIP is a development package, not a store installer.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Open an ordinary webpage (try the [practice page](https://ryanjosephkamp.github.io/link-meteor/practice.html)). Use the extension toolbar action for the side panel, or **Option+Shift+L** on Mac / **Alt+Shift+L** on Windows and Linux to select a region.
5. Drag across links, then choose **Copy text + URL**, **Add to collection**, **Review**, or **Add another region**. The card names the collection the links will go to. Escape cancels selection. You can scroll while dragging.

Chrome manages shortcut assignments at `chrome://extensions/shortcuts`. A shortcut can conflict with another extension or system shortcut; use **Change shortcut** in Link Meteor to inspect it. Reload the extension at `chrome://extensions` after rebuilding, then reload test webpages so their injected script is current.

For an existing installation, export any collections you want to retain, keep the same installation folder path, and follow the [update instructions](https://ryanjosephkamp.github.io/link-meteor/install.html). Loading a different unpacked path can create a separate extension with separate storage. JSON exports preserve captured link fields for reference, but are not a full backup of collection settings. Version 0.2.1 does not provide an import/restore flow.

## What is included

- Region, current-page, selected-open-tab, current-window and all-ordinary-window capture within the current Chrome profile.
- Optional configurable hold-letter-and-drag mode, enabled individually on permitted website origins.
- Named local collections with collection notes/tags and per-occurrence notes/tags.
- Search, domain/file-type/internal/external filters, sorting, row selection, removal and one-step undo.
- Reversible unique-URL and unique-URL-plus-anchor views. Originals and different labels/sources remain stored; expand a group to inspect them.
- Real `.xlsx`, CSV, TSV, Markdown, HTML, JSON and URL-list downloads; clipboard columns/URLs/Markdown; bookmark folders; opening at most 20 HTTP(S) URLs per confirmed batch.
- Ordered export columns. With no selection, exports include the entire filtered view across pages. When selection exists, exports use selected occurrences that still match the filters. JSON preserves every occurrence in each exported group. Other grouped exports use the displayed representative.
- Side panel (compact views for links, collections and site settings, and export, with a bottom dock showing the exact export target) and full workbench (three columns, with anchor text, URL and source as separate columns), light/dark appearance, keyboard controls, visible focus and reduced-motion styling. The design system is documented in `docs/DESIGN.md`.

## Fidelity and coverage

Anchor text is the rendered textual label with whitespace runs collapsed to one space and surrounding whitespace trimmed. Image alt text and accessible labels are separate fields. Empty anchor text stays empty, including in Markdown. Link Meteor never fetches a destination to invent a title or citation.

Each occurrence stores resolved URL, original href, source URL/title, frame URL, timestamp and batch ID. Repeated URLs are separate occurrences until you choose a grouped view. Captured `mailto:` and `tel:` URLs can be exported; batch opening/bookmarking is limited to HTTP(S). A textless bookmark uses the URL as its browser bookmark title without changing the saved anchor-text field.

A region selects a link when at least one visible, clipped client rectangle intersects it with positive area. Wrapped inline anchors have several rectangles. Scrolling accumulates links swept through the selected area. The visual highlight is limited to 250 matches to keep the overlay light; the selected count still includes all matched links up to the capture limit.

Capture covers loaded DOM links, open shadow roots and accessible same-origin frames. It does not load virtualized/infinite-scroll content, follow pagination, crawl destinations, extract PDF contents, inspect closed shadow roots, or decode opaque JavaScript buttons. Inaccessible frames receive an explicit coverage warning. Chrome-internal pages, the Chrome Web Store and incognito are unsupported. Per-tab results distinguish success, a genuine empty page, denied access, unsupported pages and errors.

Operational limits are 20,000 links per page/region, 100 tabs per capture, and 20 links per opening action. Large captures show partial-coverage warnings rather than silently truncating. Collections use Chrome's local storage quota; failed writes preserve the previously saved data and show a recovery message. Review renders 100 rows per page and loads grouped details in increments of 100. These are resource bounds, never payment gates.

CSV/TSV prefix formula-like strings with an apostrophe for safer spreadsheet import. The original string remains intact in local data, JSON and the string-typed XLSX cells. HTML and Markdown escape page-supplied text. Exported files contain your selected URLs and notes; choose their recipients deliberately.

## Develop and verify

Building from source requires Node.js 22 or newer. There are no package dependencies to install. Load the resulting `dist` folder with Chrome's **Load unpacked** option.

```sh
npm run build
npm test
npm run package
```

The build copies only packaged extension files. Packaging refuses stale source/build differences and emits a deterministic ZIP plus file hashes and truthful Git identity/dirty flags.

Browser tests reuse an installed Playwright library and Chromium/Chrome for Testing. No browser or library is downloaded by these scripts. Set `LINK_METEOR_PLAYWRIGHT` to an installed Playwright module if it is not on the normal Node resolution path.

```sh
# One isolated test browser; allow synthetic 127.0.0.1 access and bookmarks when requested.
node tests/interactive.mjs
# Press Return in that terminal to close only the test browser/server.
node tests/browser.mjs
node tests/extended-browser.mjs
node tests/site-browser.mjs        # practice-page answer keys and site screenshots
node tests/permission-browser.mjs  # run last: revokes the synthetic grant
```

For a changed build, create a new isolated profile and prepare its grants through the product's own permission paths with `LINK_METEOR_TEST_PROFILE=<new-name> node tests/prepare-grants.mjs` (a visible test browser). `node tests/visual-browser.mjs` needs no grants (`LINK_METEOR_VISUAL_PROFILE` picks its profile). `tests/design-preview.mjs` and `tests/overlay-preview.mjs` render the UI with simulated extension APIs for design iteration only; they are not acceptance evidence.

Tests store isolated profiles and cache under `.scratch/acceptance-final`, bind the local synthetic fixture server to `127.0.0.1:52478`, and fail if that port is occupied. `LINK_METEOR_TEST_PROFILE` and `LINK_METEOR_FIXTURE_PORT` can change these isolated resources. The browser suite **resets collections in its selected test profile**, so never point it at a personal browser profile. Prepare permission grants through the extension in the isolated browser. The harness records a build fingerprint and refuses reuse after packaged bytes change; prepare a fresh named test profile for a changed build. Headless optional-permission behavior was not accepted as native evidence.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` independently check OOXML and, when available, openpyxl parsing. See `docs/ACCEPTANCE.md` for current executed results, commands, native checks and limits. A declared Chrome minimum is not proof of testing that historical version. Everyday Chrome, other operating systems, screen-reader use and Excel application behavior still need human review.

## Website

`site/` is a static GitHub Pages site (home with an interactive demo and a live export preview, install, guide, privacy, and a practice page with verified answer keys). It makes no third-party requests and self-hosts its fonts. Visit [Link Meteor](https://ryanjosephkamp.github.io/link-meteor/). See `site/README.md` for structure, checks and the manual deployment steps; `.github/workflows/pages.yml` runs only when triggered by hand.

```sh
node scripts/sync-site.mjs          # copy the packaged ZIP, export modules and icons into site/
node scripts/sync-site.mjs --check  # verify the site matches the build
node tests/site-check.mjs           # pages × widths × themes, links, structure, contrast, demo
```

## Privacy

Read [the privacy explanation](docs/PRIVACY.md), [product overview](docs/PRODUCT.md), [scope and guarantees](docs/SCOPE.md) and [data contracts](docs/CONTRACTS.md). Link collection and export processing happen locally in your browser.

## Support and suggestions

[Open a GitHub issue](https://github.com/ryanjosephkamp/link-meteor/issues) to report a bug or suggest an improvement. For a bug, include your extension version, Chrome version, operating system and steps to reproduce. Use a synthetic example where possible and leave private URLs, personal collection data and credentials out of public reports.

## License and author

MIT licensed; see [LICENSE](LICENSE). The site's Atkinson Hyperlegible Next and Mono fonts retain their SIL Open Font License notices in `site/assets/fonts/`.

Created by **[Ryan Kamp](https://github.com/ryanjosephkamp/)**. Link Meteor and all its features are free. Optional support never unlocks features or changes functionality.
