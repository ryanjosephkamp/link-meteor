# Chrome Web Store Listing — Link Meteor

> Last Updated: 2026-09-27
>
> **Status: draft.** Link Meteor is not on the Chrome Web Store yet. Version 0.3.0 is packaged, and the owner's hands-on check of it passed on 2026-09-27. Submission comes after 0.3.0 is released. Before submitting, create the screenshots and promo tiles below and check this text against the released build. This file is not part of the extension package.

## Store Listing

**Extension Name** [REQUIRED]

Link Meteor

**Short Description** [REQUIRED]

Capture links with their anchor text, organize local research collections, and export them your way. Free, private, and local.

(126 characters; the same as the manifest description.)

**Detailed Description** [REQUIRED]

(Plain text for the dashboard. Check each feature against the released build before submitting.)

```text
Link Meteor collects the links on web pages you choose, keeping each link's visible text, its exact address and the page it came from, so you can review them and export them your way.

WHAT IT DOES
• Select a region: drag a rectangle across part of a page and see every link inside it, counted live. Scroll while dragging to reach more.
• Capture a whole page, tabs you pick, the current window or every window at once. Each page gets its own result, so a page Link Meteor can't read is reported, never skipped silently.
• Keep what the link actually says. Anchor text, the address, the original link and the source page stay separate. A link with no visible text stays empty instead of getting an invented title.
• Review in a side panel beside the page: search, filter by domain, file type or internal and external links, sort, group repeated addresses without losing any occurrence, and remove with Undo.
• Save named collections with notes and tags, kept in this browser only.
• Export to Excel (.xlsx), CSV, TSV, Markdown, HTML, JSON or a plain URL list, or copy as a two-column table ready to paste into a spreadsheet. Cells that look like formulas stay plain text.
• Save links as a bookmark folder, or open them in tabs.
• Hold a key and drag on any site: after one optional choice to allow Link Meteor on all sites, hold Z (or any letter, or Command on a Mac and Ctrl elsewhere) and drag. Add sites where it should never run.
• More on the capture card: open the selection in tabs, a new window or a tab group, copy it as Markdown or URLs, download it, or choose which collection it goes to.
• Export file names with the date and time, a name field for each export, and formatted Excel workbooks with an About sheet.
• Save bookmarks into an existing folder, skipping links already there.
• Back up every collection and setting to one file, and restore it on this or another computer, merged or replacing what is there, with Undo.

HOW TO USE
1. Click the Link Meteor icon in the toolbar to open the side panel.
2. Choose Select a region and drag across the links you want, or choose Capture this page.
3. Copy the links, or add them to a collection to review, filter and export.
A practice page with known answers is at https://ryanjosephkamp.github.io/link-meteor/practice.html.

PRIVACY
Everything stays in your browser. Link Meteor has no account, no server, no analytics, no ads and no tracking. Its own pages cannot connect to the internet. Capturing a link never visits it. Your collections are not synced by Link Meteor. Every feature is free.

PERMISSIONS
• Access to the page you're on: only when you click the icon, use the shortcut or choose Link Meteor in the right-click menu.
• Your open tabs: asked only when you choose to capture tabs, so you can pick them.
• Bookmarks: asked only when you save a bookmark folder or choose an existing one.
• All sites: asked once, only if you choose "Allow on all sites" so hold-key drag and page capture work everywhere. You can decline and allow sites one at a time instead.

SUPPORT
Report a bug or suggest a feature: https://github.com/ryanjosephkamp/link-meteor/issues
Guide and limits: https://ryanjosephkamp.github.io/link-meteor/guide.html
```

**Category** [REQUIRED]

Productivity

**Single Purpose** [REQUIRED]

Collects the links on web pages you choose, with each link's visible text and address, so you can review and export them.

**Primary Language** [REQUIRED]

English (United States)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/icons/128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ⬜ Not created | |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ⬜ Not created | |
| Screenshot 4 | 1280×800 | ⬜ Not created | |
| Screenshot 5 | 1280×800 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes

Take them from the released 0.3.0 build in a task-owned test profile, on the practice page or other synthetic pages only, never with real browsing or private collections, in the default Meteor theme:

1. A region being dragged on the practice page, with the live count and the capture card.
2. The side panel beside a page, showing a collection with anchor text, URL and source columns.
3. The Export panel with the format list, columns and the file name field.
4. A grouped view with one row's source occurrences expanded, showing that repeated links are kept.
5. The welcome card with "Allow on all sites (recommended)" and "Choose sites later".

The site's existing product screenshots are not 1280×800 and show 0.2.2; they are not reused.

## Permissions Justification

Each reason names the feature that uses the permission and when it is used. Chrome's own prompts appear only at those moments; nothing optional is requested at install.

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | When the person clicks the toolbar icon, presses the region shortcut or chooses a Link Meteor item in the right-click menu, Link Meteor can read the links on that one page to capture them or start region selection. It is temporary and ends when the tab moves to another page, so capturing the current page needs no lasting site access. |
| `scripting` | permissions | Runs Link Meteor's own bundled capture script on a page the person asked to capture: it reads each link's text and address and draws the selection rectangle and capture card. For hold-key drag, the same bundled script is registered only on sites the person allowed. From 0.6.0 it also runs one small bundled function in a PDF's tab, or in a page of a PDF's own site, that asks for the PDF's file so Link Meteor can read its links or put the PDFs the person chose into one ZIP or one PDF. No remote or generated code is run. |
| `storage` | permissions | Saves collections, notes, tags, reading status, stars, context snippets, page citation details and settings locally in the browser, and keeps the latest capture report for the browser session so the side panel and full view show the same result. Link Meteor does not use Chrome Sync for this data. |
| `sidePanel` | permissions | Clicking the toolbar icon opens the review workbench in Chrome's side panel, beside the page being captured. |
| `contextMenus` | permissions | Adds Link Meteor's actions to the right-click menu, depending on what was right-clicked: on a link, add it to the active collection, copy its text and address, or download a linked file; on selected text, capture its links; on a page, select a region, capture the page or save the tab as a link. The toolbar icon's menu saves the tab or the window's tabs as links, or opens the full view. |
| `clipboardWrite` | permissions | Copies the links the person selected, as a two-column table, URLs, Markdown or rich links (clickable HTML with a plain-text version), when they press a Copy button on the capture card or in the workbench, or right after a drag when they chose that setting. It also copies Copy diagnostics, which never includes addresses or names. On the capture card the copy completes after Link Meteor formats the links, which can outlast the page's normal click window, so the permission keeps an explicit Copy press from failing. Link Meteor never reads the clipboard. |
| `tabs` | optional permissions | Requested only when the person chooses the Pick tabs, This window or All windows capture scope. Link Meteor then lists open tabs' titles and addresses so the person can choose which pages to capture, and records each result's source page. Declining keeps page and region capture working. |
| `bookmarks` | optional permissions | Requested only when the person presses Bookmark in the Export panel or chooses to save into an existing folder. Link Meteor creates the bookmark folder they named, containing the selected web links. When saving into an existing folder, it also reads bookmark folder names to show the folder picker, and the chosen folder's links to skip ones already there. It never changes or removes other bookmarks. |
| `http://*/*`, `https://*/*` | optional host permissions | Never requested at install. By default Chrome asks for one site at a time: for the sites of tabs the person chose to capture, for the current page when Capture this page has lost its temporary access, or for the one site where they turn on hold-key drag. From 0.6.0 the same prompt, naming the sites, is used when the person captures the pages behind selected links, includes a frame from another site in a page capture, or gets PDF files through a page of their site. The person can instead make one explicit choice, "Allow on all sites (recommended)": on the first-run welcome card, the matching Site access switch, or a capture result where Chrome hid the page from Link Meteor, so hold-key drag, Capture this page and multi-tab capture work on any site without a prompt per site. They can exclude sites with a "Never on these sites" list, turn it off, or decline and keep the per-site route. On any site, Link Meteor reads link text and addresses only when the person captures or drags. It never sends page content anywhere: its own pages block all network connections. |
| `tabGroups` | optional permissions | Requested only when the person first chooses to open selected links as a tab group. It names the group after their collection so a large batch stays together and closes in one step. Without it, the tabs still open. |
| `downloads` | optional permissions | Requested only when the person first chooses to download the files behind selected links (for example the PDFs of research articles they captured). Link Meteor passes those URLs to `chrome.downloads.download` into a Link Meteor folder in Downloads, names each file after its link text, and reports each result. It never searches, opens, changes or removes other downloads. |
| `unlimitedStorage` | permissions | Lets large research collections, and the one-step Undo kept after restoring a backup, grow past Chrome's default 10 MB extension storage limit. The data stays on the person's computer. |

Manifest notes for reviewers: `incognito` is `not_allowed`; there are no required host permissions; `optional_host_permissions` covers only `http://*/*` and `https://*/*`; the one keyboard command (`select-region`, suggested Alt+Shift+L) starts region selection; extension pages use the content security policy `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'`. From 0.6.0 there is one sandboxed page, `ui/lookup-frame.html`, with its own policy: `sandbox allow-scripts; default-src 'none'; script-src 'self'; connect-src https://api.crossref.org https://api.datacite.org https://eutils.ncbi.nlm.nih.gov`. It is the only place a request can be made, and only for the optional Page details lookup.

**Remote code:** none. Link Meteor includes PDF.js (Mozilla, Apache-2.0) as files inside the package. It loads no code from anywhere else.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No. There is no server of Link Meteor's, no analytics and no advertising, and extension pages cannot make network connections. Nothing leaves the device unless the person turns on one optional feature, off by default:

*Page details lookup* is off unless you turn it on. When it is on and you click *Look up details*, Link Meteor sends the paper's DOI, arXiv ID or PubMed ID, and nothing else, to: Crossref (api.crossref.org) for DOIs; DataCite (api.datacite.org) for DOIs Crossref doesn't have, including arXiv's; and NCBI (eutils.ncbi.nlm.nih.gov) for PubMed IDs. No page address, link text, note or collection name is sent. No cookies are sent or kept. Like any website you visit, those services see your IP address and your browser's version and language. What they return (title, authors, date, journal) is saved in this browser with the link.

The request is made from the sandboxed page named above, which cannot read the person's collections or settings and is handed only the identifier. If the dashboard counts this, declare **Website content** as transmitted only for this optional feature, at the person's request, to those three services, to fill in a citation.

Recommended answers, to check against the dashboard's definitions at submission. If the form counts data handled only on the device, declare **Website content** and **Web history** as handled on the device, not transmitted, not sold and used only for the single purpose.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No (addresses of pages the person captures are saved on the device as each link's source) | No | Show where each link came from | No |
| User activity | No | No | — | No |
| Website content | No (link text and addresses, the words around each link, and citation details that pages publish about themselves, from pages the person captures, are saved on the device) | No | The collections the person builds | No |

Actions the person takes can move data, as described in the privacy policy: copying puts it on the clipboard, downloads save files (including citation files), bookmarks may be synced by Chrome's own bookmark sync, and opening links visits them. Importing reads a file, pasted text or a bookmark folder the person chooses, in the browser. From 0.6.0:
- To read the links in a PDF that is open in a tab, Link Meteor asks Chrome for the file again from the same address, as that page. The PDF is read inside the browser by PDF.js, which is part of Link Meteor. It is never uploaded.
- Scrolling a page to its end, following a page's own Next link (20 pages at most) and capturing the pages behind selected links (20 at most, one at a time, in background tabs) load pages as they would if the person scrolled, clicked or opened them. Each starts only from a click, shows a counter and Stop, and never follows the links it finds.
- *Download as one ZIP* and *Combine into one PDF* get each chosen PDF through a page of its own site, put them together inside the browser and save the result through Chrome's download. Nothing is uploaded.
- Nothing is looked up online unless the person turns on Page details lookup, described above: identifiers are read from each link's address, and citation details from the pages and PDFs Link Meteor reads.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]

https://ryanjosephkamp.github.io/link-meteor/privacy.html

The page describes every 0.3.0 permission above (all-sites access, `tabGroups`, `unlimitedStorage`) and the backup file, matching `docs/PRIVACY.md`. It goes live with the next site deployment; check it at this address before submitting.

## Distribution

**Visibility**: Public (the owner decides at submission)
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]

Ryan Kamp

**Contact Email** [REQUIRED]

To be chosen by the owner at submission. It is shown publicly on the listing and must be monitored.

**Support URL / Email** [RECOMMENDED]

https://github.com/ryanjosephkamp/link-meteor/issues

**Homepage URL** [RECOMMENDED]

https://ryanjosephkamp.github.io/link-meteor/

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.5.0 | 2026-10-01 (packaged) | Context around each link; page citations read from pages' own tags; identifiers (DOI, arXiv, PubMed, PMC, ISBN) read from addresses; citations borrowed from a saved page about the same work; reading status, stars and Insights; citation exports (BibTeX, RIS, CSL-JSON, annotated bibliography, Obsidian note) and new export columns; importing links from files, pasted text and bookmark folders; moving and copying links between collections; the toolbar icon closing the side panel and a labeled Full view button; the last backup's date; clearer messages on PDFs. No new permission. Backup format 3. ZIP SHA-256 `57020852b82b26d8d0562707bddeb00ef4ffcd5875264c23ba0e6da875ff589f`. | Packaged, not yet submitted |
| 0.4.0 | 2026-09-29 (released on GitHub) | Seven themes with light and dark, and a themed toolbar icon; after-a-drag choices (show the card, copy right away, add right away); leaving out navigation links; card filters; marking and skipping links already saved; copy as rich links; saving tabs as links; custom columns; downloading the files behind links; highlights that follow their links while scrolling; more right-click and toolbar menu actions; Copy diagnostics. New permission: optional `downloads`. ZIP SHA-256 `68105db8e9dc47e1a222a2f668e5cbc22df315f8a24f09d83f57f036f6bc7036`. | Released as a ZIP, not submitted |
| 0.3.0 | 2026-09-27 (released on GitHub) | All-sites choice with exceptions and a Command or Ctrl hold key, a welcome card, more capture card actions, opening up to 500 links, export file names and formatted workbooks, existing bookmark folders, backup and restore. New permissions: optional `tabGroups`, and `unlimitedStorage`. ZIP SHA-256 `25463687d2f0a7b9e280de7d4f905753cb9b8cc57b359129937f8ea5e98302c7`. | Released as a ZIP, not submitted |

Versions 0.1.0 to 0.4.0 were distributed only as a ZIP for Load unpacked and were never submitted.

## Review Notes

### Test instructions for the review team

1. Open https://ryanjosephkamp.github.io/link-meteor/practice.html. Each section states how many links it contains.
2. Click the Link Meteor toolbar icon. The side panel opens.
3. Choose Select a region, drag across a section, and compare the count on the capture card with the section's answer.
4. Choose Add to collection, then review, filter and export the links from the side panel.
5. On the welcome card, choose "Allow on all sites (recommended)", then hold Z and drag on any page.

### Known Issues / Limitations

- Chrome does not allow extensions on its own pages, the Chrome Web Store or incognito windows (Link Meteor does not request incognito access).
- Links inside closed page components cannot be seen or captured. Frames from other sites are reported as unreadable, not skipped silently.
- Tested on macOS:
  - by hand in Chrome, Brave and Microsoft Edge;
  - in automation in Chrome for Testing, including the checks that need no grants on Chrome for Testing 116, the declared minimum.

  Windows and Linux are listed as untested in `docs/ACCEPTANCE.md` until checked.

### Rejection History

None yet.
