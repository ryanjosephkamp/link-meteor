# Link Meteor

Capture the trail. Keep the source.

Link Meteor is a free Chrome extension for collecting links with their **actual anchor text and URL in separate fields**, reviewing their sources, and exporting a useful research collection. It has no account, ads, telemetry, paid tier, or backend dependency.

This repository contains the first working Chrome baseline. It has not been published to the Chrome Web Store. Firefox, Safari, AI features, and the GitHub Pages website are deferred.

## Try the development build

1. Run `npm run build` with Node 22 or newer. There are no package dependencies to install.
2. Open `chrome://extensions` in Chrome and enable Developer mode for local extension development.
3. Choose **Load unpacked** and select this repository's `dist` directory.
4. Open an ordinary webpage. Use the extension toolbar action for the side panel, or **Option+Shift+L** on Mac / **Alt+Shift+L** on Windows and Linux to select a region.
5. Drag across links, then choose **Copy text + URL**, **Add to collection**, or **Review**. Escape cancels selection. You can scroll while dragging and append another region.

Chrome manages shortcut assignments at `chrome://extensions/shortcuts`. A shortcut can conflict with another extension or system shortcut; use **Change shortcut** in Link Meteor to inspect it. Reload the extension at `chrome://extensions` after rebuilding, then reload test webpages so their injected script is current. If an automation profile caches an old worker, use a new task-owned test profile instead of treating that result as current-build evidence.

The ZIP under `artifacts/` is an unpacked development package: extract it to a folder and select that folder with **Load unpacked**. It is not a store installer.

## What is included

- Region, current-page, selected-open-tab, current-window and all-ordinary-window capture within the current Chrome profile.
- Optional configurable hold-letter-and-drag mode, enabled individually on permitted website origins.
- Named local collections with collection notes/tags and per-occurrence notes/tags.
- Search, domain/file-type/internal/external filters, sorting, row selection, removal and one-step undo.
- Reversible unique-URL and unique-URL-plus-anchor views. Originals and different labels/sources remain stored; expand a group to inspect them.
- Real `.xlsx`, CSV, TSV, Markdown, HTML, JSON and URL-list downloads; clipboard columns/URLs/Markdown; bookmark folders; opening at most 20 HTTP(S) URLs per confirmed batch.
- Ordered export columns. With no selection, exports include the entire filtered view across pages. When selection exists, exports use selected occurrences that still match the filters. JSON preserves every occurrence in each exported group. Other grouped exports use the displayed representative.
- Side panel and full workbench, light/dark appearance, keyboard controls, visible focus and reduced-motion styling.

## Fidelity and coverage

Anchor text is the rendered textual label with whitespace runs collapsed to one space and surrounding whitespace trimmed. Image alt text and accessible labels are separate fields. Empty anchor text stays empty, including in Markdown. Link Meteor never fetches a destination to invent a title or citation.

Each occurrence stores resolved URL, original href, source URL/title, frame URL, timestamp and batch ID. Repeated URLs are separate occurrences until you choose a grouped view. Captured `mailto:` and `tel:` URLs can be exported; batch opening/bookmarking is limited to HTTP(S). A textless bookmark uses the URL as its browser bookmark title without changing the saved anchor-text field.

A region selects a link when at least one visible, clipped client rectangle intersects it with positive area. Wrapped inline anchors have several rectangles. Scrolling accumulates links swept through the selected area. The visual highlight is limited to 250 matches to keep the overlay light; the selected count still includes all matched links up to the capture limit.

Capture covers loaded DOM links, open shadow roots and accessible same-origin frames. It does not load virtualized/infinite-scroll content, follow pagination, crawl destinations, extract PDF contents, inspect closed shadow roots, or decode opaque JavaScript buttons. Inaccessible frames receive an explicit coverage warning. Chrome-internal pages, the Chrome Web Store and incognito are unsupported. Per-tab results distinguish success, a genuine empty page, denied access, unsupported pages and errors.

Operational limits are 20,000 links per page/region, 100 tabs per capture, and 20 links per opening action. Large captures show partial-coverage warnings rather than silently truncating. Collections use Chrome's local storage quota; failed writes preserve the previously saved data and show a recovery message. Review renders 100 rows per page and loads grouped details in increments of 100. These are resource bounds, never payment gates.

CSV/TSV prefix formula-like strings with an apostrophe for safer spreadsheet import. The original string remains intact in local data, JSON and the string-typed XLSX cells. HTML and Markdown escape page-supplied text. Exported files contain your selected URLs and notes; choose their recipients deliberately.

## Develop and verify

```sh
npm run build
npm test
npm run package
```

The build copies only packaged extension files. Packaging refuses stale source/build differences and emits a deterministic ZIP plus file hashes and truthful Git identity/dirty flags.

Browser tests reuse an installed Playwright library and Chromium/Chrome for Testing. No browser or library is downloaded by these scripts. Set `LINK_METEOR_PLAYWRIGHT` to an installed Playwright module if it is not on the normal Node resolution path. The Codex runtime path is also detected on the development machine.

```sh
# One task-owned test browser; allow synthetic 127.0.0.1 access and bookmarks when requested.
node tests/interactive.mjs
# Press Return in that terminal to close only the test browser/server.
node tests/browser.mjs
node tests/extended-browser.mjs
```

Tests store isolated profiles and cache under `.scratch/acceptance-final`, bind the local synthetic fixture server to `127.0.0.1:52478`, and fail if that port is occupied. `LINK_METEOR_TEST_PROFILE` and `LINK_METEOR_FIXTURE_PORT` can change these task-owned resources. The browser suite **resets collections in its selected test profile**, so never point it at a personal browser profile. Native permission grants are part of preparation, not silently forged by the tests. The harness records a build fingerprint and refuses reuse after packaged bytes change; prepare a fresh named test profile for a changed build. Headless optional-permission behavior was not accepted as native evidence.

`tests/xlsx-fixture.mjs` and `tests/verify-workbook.py` independently check OOXML and, when available, openpyxl parsing. See `docs/ACCEPTANCE.md` for current executed results, commands, native checks and limits. A declared Chrome minimum is not proof of testing that historical version. Everyday Chrome, other operating systems, screen-reader use and Excel application behavior still need human review.

## Privacy and later design work

Read [the privacy explanation](docs/PRIVACY.md) and [the accepted product scope](docs/alignment/2026-09-25/ALIGNMENT.md). The Opus package under `docs/opus-handoff/` separates extension refinement from the future GitHub Pages site. The user initiates that work; no website is implemented or deployed by this iteration.

The implementation, icons and interface are original. The reference product informed functional requirements; no third-party code, branding or assets were copied. Trademark/name clearance has not been established.
