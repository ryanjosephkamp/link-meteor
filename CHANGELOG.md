# Changelog

## 0.4.0 (2026-09-29)

"Make it yours": themes and a card that works the way you do, plus five additions from the first hands-on check:
- themes and appearance;
- what happens after a drag;
- saving tabs as links;
- custom columns;
- downloading the files behind links;
- more right-click actions.

### Extension

- **Seven themes**, each light and dark: Meteor, Comet, Aurora, Ember, Nebula, Graphite and High contrast. **Appearance** chooses System, Light or Dark. The side panel, full view, capture card, selection highlight and toolbar icon all follow the theme. Meteor looks exactly as before.
- **After a drag:** *Show the card*, as before; *Copy right away*, as a text and URL table, URLs, Markdown or rich links; or *Add right away*, with Undo in a small notice.
- **Leave out navigation links.** Links in page-level menus, headers, footers and sidebars start unticked, and the card says how many, with *Include them*. A post's own title link still counts. *Capture this page* leaves them out too and offers *Include them*.
- **Card filters:** All, Other sites, PDFs and Same site.
- **Already saved.** Links the collection already has are marked *Saved* on the card. *Skip links already saved* leaves them out when adding.
- **Copy as rich links**, on the card (shortcut L) and in the Export panel: HTML and plain text that paste into Google Docs, Word or Notion as clickable anchor text.
- **Save tabs as links.** Besides capturing the links inside tabs, choose *The tabs themselves* to save this tab, picked tabs, or every tab in the window or all windows, one link each, with the tab's title. Pages that aren't web pages are skipped and counted.
- **Custom columns.** Up to 20 per collection, named in the collection editor and filled in by hand, like notes. They appear in each link's details, in search, in every export and in backups. *Fill for selected links* sets one value on many links, with Undo. A backup merge joins columns with the same name.
- **Download the files behind links**: PDFs, images, documents and other files. Use the card's *Download N files* (shortcut F), the Export panel's *Download files*, *Download* in a link's details, or *Download linked file* in the right-click menu.
  - Files are saved in `Downloads/Link Meteor/<collection>/`, named after their anchor text.
  - Downloads run three at a time. Link Meteor asks first above 10 files, and *Cancel* stops what hasn't finished.
  - A link that gives a web page instead of a file, often a sign-in page, is reported as such, and a failed download says why.
- **Highlights stay on their links** while the page scrolls, and unticked links are outlined.
- **More right-click actions**, under Chrome's *Link Meteor* submenu:
  - on a link: *Add link to "collection"*, *Copy link text + URL*, *Download linked file* (for file links) and *Select a region*;
  - on selected text: *Capture links in the selection*;
  - on the page: *Select a region*, *Capture this page* and *Save this tab as a link*;
  - on the toolbar icon: *Save this tab as a link*, *Save all tabs in this window as links* and *Open the full view*.
- **Copy diagnostics**, in About and help, copies versions, settings, permission choices and counts for a bug report, never addresses, site names, titles, notes, tags or collection names.
- **Backups** use format 2, which adds the new settings and custom columns. 0.4.0 restores 0.3.0 backups; 0.3.0 can't restore a 0.4.0 backup.
- **Fix:** *Capture links in the selection* and hold-key drag no longer depend on Chrome's collapsed-selection flag, which Chrome 116 reports wrongly inside shadow roots.

### Permissions

- **Optional `downloads`.** Asked the first time you download files, in the full view. Chrome describes it as "Manage your downloads". Link Meteor uses it only to save the files you choose and follow those downloads; it never reads, opens, changes or removes your other downloads.
- The right-click and toolbar menus use the `contextMenus` permission that 0.3.0 already had.

### Website

- A theme menu with every palette in light and dark. Links from the extension open the site in your theme.
- The download is now 0.4.0.
- The privacy page describes the downloads permission and the new menus.
- The guide, home and install pages cover the new features.

### Download

`link-meteor-0.4.0.zip`, 570,447 bytes, SHA-256 `68105db8e9dc47e1a222a2f668e5cbc22df315f8a24f09d83f57f036f6bc7036`. To update from 0.3.0, replace the contents of the same folder, then reload Link Meteor at `chrome://extensions`. Your collections stay with that folder.

### Known issues

- Ember light's red Remove buttons are close in color to its orange links. They also carry a trash icon and the word Remove. This will be adjusted in the next release.
- Removing all-sites access can also remove access to sites you allowed one at a time. That is Chrome's behavior, as in 0.3.0.
- Tested so far:
  - automated checks without grants in Chrome for Testing 151 on macOS, Windows and Linux;
  - the checks that need Allow clicks, on macOS;
  - the checks that need no grants on Chrome for Testing 116, except the toolbar button, which the test tool can't press there;
  - the owner's hands-on check in everyday Chrome on macOS.

  The right-click menus can't be opened by automated Chrome, so their automated checks are simulations; the hands-on check covered them. Screen readers are not yet tested. See [testing and compatibility](docs/ACCEPTANCE.md).
- The site's videos and product screenshots still show 0.2.2.

## 0.3.0 (2026-09-27)

A feature release. The main additions:
- hold-key drag everywhere after one choice;
- a capture card that can open, copy, download and bookmark;
- export file names and formatted workbooks;
- saving into existing bookmark folders;
- backup and restore.

### Extension

- **Allow on all sites, once.** A welcome card, shown once, offers **Allow on all sites (recommended)**, **Choose sites later** or Close. With all-sites access, hold-key drag and *Capture this page* work on every site. **Never on these sites** lists sites where hold-key drag should never run. Declining keeps the one-site-at-a-time route, and the switch in Site access changes the choice later.
- **Command or Ctrl as the hold key.** Hold a letter (Z by default), or Command on a Mac and Ctrl elsewhere, and drag. A plain Command-click or Ctrl-click still opens the link.
- ***Capture this page* after the tab moves to a new site.** With all-sites access it just works. Without it, Link Meteor asks for the new site in the same click. When Chrome hides the page's address, the result offers to allow all sites.
- **Pages already open when Link Meteor starts.** They get hold-key drag without a reload, including after an install or update.
- **A fuller capture card:**
  - it opens links in tabs, a new window or a tab group;
  - it copies URLs or Markdown, downloads a file, or saves to bookmarks;
  - its **Adds to** line changes the destination collection;
  - unticking a link in the preview leaves it out of every action;
  - one-letter shortcuts work while focus is in the card.
- **Opening more links.** Up to 500 links at once, in tabs, a new window or a tab group. More than 20 asks first, more than 100 asks with stronger wording, and more than 500 is refused before anything opens. A tab group takes the collection's name when Chrome allows tab groups, and stays unnamed otherwise.
- **Export file names.** The default name is the collection and the date and time, for example `Urban-heat-islands-sources_2026-09-26_1432.xlsx`. An optional prefix and the date format are in the Export panel, and a File name field names a single export.
- **Formatted Excel workbooks.** A bold header row that stays visible while scrolling, filter buttons, fitted columns, clickable links whose cell text stays the exact URL, and an About sheet: when, from which collection and view, and with which filters. Every cell is still text.
- **JSON exports** now wrap the rows as `{about, rows}`, where `rows` is exactly the 0.2.2 array. CSV and TSV are unchanged.
- **Existing bookmark folders.** Choose any folder by its path, and skip links already there.
- **Backup and restore.** **Download a backup** saves one file with every collection, link, note, tag and setting. **Restore from a backup** shows a preview first, then merges or replaces, with Undo afterwards. It works on this computer or another one.
- **Select all** across pages, plus **Remove all in this view** and **Empty this collection**, both with Undo.

### Permissions

- **Optional `tabGroups`.** Asked once, the first time you open links as a tab group, so the group can take the collection's name.
- **`unlimitedStorage`.** No prompt. It lets large collections, and the Undo kept after a restore, grow past Chrome's default 10 MB for extension storage. The data stays in this browser.
- **All-sites access** uses the optional `http://*/*` and `https://*/*` permissions that 0.2.2 already declared. It is asked for only through the choice above, never at install.

### Website

- The download is now 0.3.0.
- The privacy page lists the new permissions and backups.
- The install page has a **Works in** section and an up-to-date folder listing.
- The guide covers the new features.

### Download

`link-meteor-0.3.0.zip`, 368,539 bytes, SHA-256 `25463687d2f0a7b9e280de7d4f905753cb9b8cc57b359129937f8ea5e98302c7`. To update from 0.2.2, replace the contents of the same folder, then reload Link Meteor at `chrome://extensions`. Your collections stay with that folder. See the install page's update steps.

### Known issues

- Removing all-sites access, with Link Meteor's **Remove Chrome's access** or with Chrome's own controls, can also remove access to sites you allowed one at a time. That is Chrome's behavior. Link Meteor turns hold-key drag off where it no longer has access, and asks again when needed.
- Tested on macOS only:
  - automated checks in Chrome for Testing 151;
  - the owner's hands-on checks in everyday Chrome, Brave and Microsoft Edge;
  - the checks that need no grants on Chrome for Testing 116.

  Windows, Linux and screen readers are not yet tested. See [testing and compatibility](docs/ACCEPTANCE.md).
- The site's videos and product screenshots still show 0.2.2.

## 0.2.2 (2026-09-26)

A small release: an About and help area in the extension, and a fuller website. Capture, export and storage work exactly as in 0.2.1.

### Extension

- **About and help.** A closed-by-default area in the side panel and full view shows the version and the creator credit, with links to the guide, bug reports and suggestions, the website, the source code and optional GitHub Sponsors. The new **?** button opens it. The links open in a new tab only when you click one; nothing opens or is sent automatically.
- No new permissions. The background worker, capture script, export and model code and icons are byte-for-byte the same as 0.2.1.

### Website

- A short demo video on the home page and an install walkthrough on the install page. Both are silent, with captions and a transcript, and play only when you press play.
- A creator credit with contact links in every footer, and a new About page covering how to report bugs, optional support, credits and how the videos were made.
- Refreshed product screenshots from 0.2.2.
- A troubleshooting entry for *Capture this page* after the tab moves to a new site.

### Download

`link-meteor-0.2.2.zip`, 198,835 bytes, SHA-256 `ceb6b778a0f93a6651e9c036fb6535773919ffa78b7ad4b88c692d35983b4e9d`. To update an existing installation, follow the install page's update steps and keep the same folder, so your collections stay with it.

### Known issues

- After the side panel stays open and the tab moves to a new site, *Capture this page* reports that Link Meteor doesn't have access. Click the Link Meteor toolbar icon on the new page first. The next feature release plans a one-time choice to allow all sites.
- Not yet verified: Windows and Linux, Chrome 116, screen readers, and other Chromium-based browsers. See [testing and compatibility](docs/ACCEPTANCE.md).
