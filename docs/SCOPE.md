# Product scope and guarantees

Link Meteor's Chrome release serves research and source collection, with the same tools useful for admin panels, ticket systems and product lists. All features are free, without accounts, subscriptions, advertisements, telemetry or a hosted backend dependency. Optional sponsorship is separate from functionality.

## Capture and review

- Arm regional capture with a configurable Chrome shortcut, drag a rectangle, see live matches/counts, cancel with Escape, scroll during selection and append additional regions. The optional hold-letter-and-drag gesture works only on explicitly permitted origins and excludes editable typing.
- Capture the current page, selected open tabs, current window or all ordinary windows within the current Chrome profile. Show the scope before collection; retain successful results when other pages are denied, unsupported, empty or failed. A genuinely empty page must remain distinct from inaccessible content.
- Review anchor text and URL in separate fields, alongside their source. Provide search, domain/file-type/internal/external filtering, sorting, row selection, removal and undo.
- Save named local collections with notes/tags, per-occurrence notes/tags, append operations, explicit deletion and persistence across browser restarts. Failed writes preserve previously saved data and report recovery options.
- Provide keyboard-accessible controls, visible focus, meaningful labels, light/dark presentation, reduced motion and useful empty/error states. The overlay, side panel and full workbench serve different space constraints without changing the data contract.

“Specific pages” means selected open tabs. Capture does not crawl destinations, visit pasted URLs, paginate, continuously scroll on its own, load virtualized items, parse PDF contents or decode opaque JavaScript buttons. A normal link to a PDF is supported. Authenticated pages can work when accessible to the user and permitted, but every application/layout is not guaranteed.

## Faithful data

Every occurrence retains a stable ID, anchor text, resolved destination URL, original href, source page URL/title, frame URL, capture time and batch ID. Collection association, user notes/tags and extracted facts stay separate. Link Meteor never fetches a destination merely to invent a title or citation.

Anchor text is the visible textual label with whitespace runs collapsed and surrounding whitespace trimmed. “Download PDF” remains exactly that label after whitespace normalization. Image alt text and accessible labels use a separate field; a textless anchor stays empty. Destination titles and inferred names must not replace anchor text.

Repeated destinations remain separate stored occurrences. Unique-URL and unique-URL-plus-anchor modes are reversible views/export choices. Different labels and source pages remain accessible in grouped details; originals are retained. Storage schema v1 and its exact field/message contracts are documented in [CONTRACTS.md](CONTRACTS.md).

A region captures an anchor if at least one of its visible, clipped client rectangles intersects with positive area. Wrapped links can have multiple rectangles; scrolling accumulates swept links. Capture scans loaded DOM links, open shadow roots and accessible same-origin frames. Inaccessible frames and partial coverage are reported. Browser-restricted pages, incognito and closed shadow roots are unsupported.

Resource bounds are explicit: 20000 links per page/region, 100 tabs per capture and 20 URLs per opening action. Overlay highlighting is capped at 250 visual matches while selection counts still cover captured links up to the limit. Review pages contain 100 rows and grouped details load in increments of 100. These bounds must never become payment gates or silent truncation.

## Exports and actions

Provide real `.xlsx`, CSV, TSV, URL-list, Markdown, HTML and JSON downloads; clipboard columns, URLs and Markdown; bookmark folders; and bounded opening of selected HTTP(S) URLs. Anchor text and URL are the default separate spreadsheet/clipboard columns, and users can choose export columns and order.

With no selection, exports cover the full filtered view across pages. With selection, exports use selected occurrences that still match filters. JSON retains all exported grouped occurrences; other grouped formats use the displayed representative. Handle commas, quotes, newlines, Unicode and formula-like strings. CSV/TSV use an apostrophe for formula-safe import; originals remain unchanged in stored data, JSON and string-typed XLSX cells. Escape untrusted HTML/Markdown and validate action URL schemes. Captured `mailto:` and `tel:` can be exported but are not batch-opened/bookmarked.

A textless bookmark uses the URL for its browser bookmark title without changing stored anchor text. Browser bookmark sync is separate from local collections. Opening tabs, downloading files, writing clipboard content and creating bookmarks happen only through user actions. Version 0.2.2 has no collection import/restore flow.

## Architecture, access and privacy

Manifest V3 packages local extension code. Capture, background coordination, storage/model, review and export modules have separate responsibilities. Pure model/export modules do not depend on browser UI APIs; future ports must be verified independently rather than inferred from shared code.

Current-page activation uses user-triggered access. Multi-tab capture and persistent hold mode request relevant site permissions when needed; bookmarking requests bookmark access at its action. Do not request permissions for hypothetical features. Data stays in extension-local storage rather than a Link Meteor service or Chrome Sync. See [PRIVACY.md](PRIVACY.md) for the browser-controlled exceptions and permission purposes.

## Website and further work

The website explains installation, features, privacy, limitations and usage, offers a synthetic practice page and a development ZIP, and remains useful and accessible without tracking or external media services. Branding, code, copy and assets are independently created; similar functionality does not establish name or trademark clearance.

Firefox/Safari ports, destination metadata enrichment, continuous capture and AI integrations are outside this release. Future capabilities must preserve originals and require explicit user choices about any new data destinations or costs. Existing structured exports do not imply a remote AI service. Browser-store distribution is deferred; ZIP plus Load unpacked is the supported installation route.

## Evidence standard

Tests should exercise the loaded extension and independently inspect exports, including special characters, empty labels, formulas and provenance. Synthetic pages cover representative regions, frames, shadow roots, duplicates, scopes, permissions, partial failures, persistence and large collections. API mocks, screenshots, unit checks, automated Chromium, native Chrome interactions and human use establish different things; keep those distinctions visible. Never infer general performance, historical browser support or accessibility certification from a single successful run. See [ACCEPTANCE.md](ACCEPTANCE.md) for actual results and limits.
