# Chrome Web Store Listing — Link Meteor

> Last Updated: 2026-09-26
>
> **Status: draft.** Link Meteor is not on the Chrome Web Store yet. Submission is planned after version 0.3.0. Items marked **[Planned 0.3.0]** describe work in progress and must be checked against the released build, then kept or removed, before submission. This file is not part of the extension package.

## Store Listing

**Extension Name** [REQUIRED]

Link Meteor

**Short Description** [REQUIRED]

Capture links with their anchor text, organize local research collections, and export them your way. Free, private, and local.

(126 characters; the same as the manifest description.)

**Detailed Description** [REQUIRED]

(Plain text for the dashboard. Remove the bracketed planned markers once each feature has shipped and been checked.)

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
• [Planned 0.3.0] Hold a key and drag on any site: after one optional choice to allow Link Meteor on all sites, hold Z (or any letter, or Command on a Mac and Ctrl elsewhere) and drag. Add sites where it should never run.
• [Planned 0.3.0] More on the capture card: open the selection in tabs, a new window or a tab group, copy it as Markdown or URLs, download it, or choose which collection it goes to.
• [Planned 0.3.0] Export file names with the date and time, a name field for each export, and formatted Excel workbooks with an About sheet.
• [Planned 0.3.0] Save bookmarks into an existing folder, skipping links already there.
• [Planned 0.3.0] Back up every collection and setting to one file, and restore it on this or another computer, merged or replacing what is there, with Undo.

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
• Bookmarks: asked only when you save a bookmark folder.
• [Planned 0.3.0] All sites: asked once, only if you choose "Allow on all sites" so hold-key drag and page capture work everywhere. You can decline and allow sites one at a time instead.

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
5. [Planned 0.3.0] The welcome card with "Allow on all sites (recommended)" and "Choose sites later".

The site's existing product screenshots are not 1280×800 and show 0.2.2; they are not reused.

## Permissions Justification

Each reason names the feature that uses the permission and when it is used. Chrome's own prompts appear only at those moments; nothing optional is requested at install.

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | When the person clicks the toolbar icon, presses the region shortcut or chooses a Link Meteor item in the right-click menu, Link Meteor can read the links on that one page to capture them or start region selection. It is temporary and ends when the tab moves to another page, so capturing the current page needs no lasting site access. |
| `scripting` | permissions | Runs Link Meteor's own bundled capture script on a page the person asked to capture: it reads each link's text and address and draws the selection rectangle and capture card. For hold-key drag, the same bundled script is registered only on sites the person allowed. No remote or generated code is run. |
| `storage` | permissions | Saves collections, notes, tags and settings locally in the browser, and keeps the latest capture report for the browser session so the side panel and full view show the same result. Link Meteor does not use Chrome Sync for this data. |
| `sidePanel` | permissions | Clicking the toolbar icon opens the review workbench in Chrome's side panel, beside the page being captured. |
| `contextMenus` | permissions | Adds "Link Meteor: select a region" and "Link Meteor: collect this page" to the right-click menu on pages. |
| `clipboardWrite` | permissions | Copies the links the person selected, as a two-column table, URLs or Markdown, when they press a Copy button on the capture card or in the workbench. On the capture card the copy completes after Link Meteor formats the links, which can outlast the page's normal click window, so the permission keeps an explicit Copy press from failing. Link Meteor never reads the clipboard. |
| `tabs` | optional permissions | Requested only when the person chooses the Pick tabs, This window or All windows capture scope. Link Meteor then lists open tabs' titles and addresses so the person can choose which pages to capture, and records each result's source page. Declining keeps page and region capture working. |
| `bookmarks` | optional permissions | Requested only when the person presses Bookmark in the Export panel. Link Meteor creates the bookmark folder they named, containing the selected web links. [Planned 0.3.0] When saving into an existing folder, it also reads bookmark folder names to show the folder picker, and the chosen folder's links to skip ones already there. It never changes or removes other bookmarks. |
| `http://*/*`, `https://*/*` | optional host permissions | Never requested at install. Today Chrome asks for one site at a time: for the sites of tabs the person chose to capture, or the one site where they turn on hold-key drag. [Planned 0.3.0] The person can also make one explicit choice, "Allow on all sites (recommended)" on the first-run welcome card or the matching settings switch, so hold-key drag, Capture this page and multi-tab capture work on any site without a prompt per site. They can exclude sites with a "Never on these sites" list, turn it off, or decline and keep the per-site route. On any site, Link Meteor reads link text and addresses only when the person captures or drags. It never sends page content anywhere: its own pages block all network connections. |
| `tabGroups` | optional permissions | **[Planned 0.3.0]** Requested only when the person first chooses to open selected links as a tab group. It names the group after their collection so a large batch stays together and closes in one step. Without it, the tabs still open. |
| `unlimitedStorage` | permissions | **[Planned 0.3.0]** Lets large research collections, and the one-step Undo kept after restoring a backup, grow past Chrome's default 10 MB extension storage limit. The data stays on the person's computer. |

Manifest notes for reviewers: `incognito` is `not_allowed`; there are no required host permissions; `optional_host_permissions` covers only `http://*/*` and `https://*/*`; the one keyboard command (`select-region`, suggested Alt+Shift+L) starts region selection; extension pages use the content security policy `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'`.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No. Nothing leaves the device: there is no server, analytics, advertising or third-party service, and extension pages cannot make network connections.

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
| Website content | No (link text and addresses from pages the person captures are saved on the device) | No | The collections the person builds | No |

Actions the person takes can move data, as described in the privacy policy: copying puts it on the clipboard, downloads save files, bookmarks may be synced by Chrome's own bookmark sync, and opening links visits them.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]

https://ryanjosephkamp.github.io/link-meteor/privacy.html

Before submission, it must describe every 0.3.0 permission above (all-sites access, `tabGroups`, `unlimitedStorage`) and the backup file, matching `docs/PRIVACY.md`.

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
| 0.3.0 | Planned | First submission: all-sites choice with exceptions and a Command or Ctrl hold key, a welcome card, more capture card actions, opening up to 500 links, export file names and formatted workbooks, existing bookmark folders, backup and restore. | Draft |

Versions 0.1.0 to 0.2.2 were distributed only as a ZIP for Load unpacked and were never submitted.

## Review Notes

### Test instructions for the review team

1. Open https://ryanjosephkamp.github.io/link-meteor/practice.html. Each section states how many links it contains.
2. Click the Link Meteor toolbar icon. The side panel opens.
3. Choose Select a region, drag across a section, and compare the count on the capture card with the section's answer.
4. Choose Add to collection, then review, filter and export the links from the side panel.
5. [Planned 0.3.0] On the welcome card, choose "Allow on all sites (recommended)", then hold Z and drag on any page.

### Known Issues / Limitations

- Chrome does not allow extensions on its own pages, the Chrome Web Store or incognito windows (Link Meteor does not request incognito access).
- Links inside closed page components cannot be seen or captured. Frames from other sites are reported as unreadable, not skipped silently.
- Tested on macOS in Chrome and Chrome for Testing. Windows, Linux and other Chromium browsers are listed as untested in `docs/ACCEPTANCE.md` until checked.

### Rejection History

None yet.
