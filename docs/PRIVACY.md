# Link Meteor privacy and permissions

Link Meteor processes captured links locally in Chrome. It has no account, remote service, analytics, advertisements, telemetry or paid functionality. Capturing a link does not visit its destination.

**Nothing leaves your browser unless you turn on a feature that says exactly what it sends, and where.** From 0.6.0 there is one such feature, [Page details lookup](#page-details-lookup), and it is off unless you turn it on. Link Meteor's own pages still cannot contact any server: only a sealed frame can, and only for that lookup.

## What is stored

Named collections contain visible anchor text, separately labeled accessible text, destination URLs, original hrefs, source page URLs/titles, frame URLs, capture times/batch IDs and your notes/tags. From 0.5.0 they can also hold:
- the words around each link on its page (a context snippet of at most 400 characters), unless you turn that off;
- citation details that pages you capture from, or tabs you save as links, publish about themselves in their own citation tags (title, authors, date, journal, DOI and similar), read from the page Link Meteor already has open;
- your reading status and stars;
- for imported links, the name of the file or bookmark folder they came from.

From 0.6.0 they can also hold:
- for a link read from a PDF, the page of the PDF it is on;
- what a PDF says about itself (its title, arXiv's stamp, a DOI), read from the PDF's own file;
- details a lookup returned (title, authors, date, journal), when you turned Page details lookup on and asked for one. Each citation says where it was read.

These are stored in `chrome.storage.local` in the current browser profile. Collection data is not placed in Chrome Sync by this extension. Chrome's profile backup or operating-system backup behavior is separate.

The current invoking tab and latest capture report are kept in session storage so separate views can show the same result. The session report can be dismissed. With "Leave out navigation links", the latest *Capture this page*'s left-out links (at most 5,000) wait there too, so *Include them* can add them; and the page card's 20 most recent adds are listed there, so Undo can take one back. The 10 most recent imports, and the 10 most recent moves and copies between collections, are listed there too, so Undo can reverse one; they name which links went where, not what the links say. While a capture that takes several steps is running (scrolling a page to its end, following Next, capturing selected pages, or getting PDF files), its progress waits there too, so a restarted background worker can finish it or say it was interrupted; it holds addresses and counts, never page content. Files the card or the right-click menu could not download yet, because Chrome had not given download access, wait there for up to 10 minutes, until the full view shows them once with Chrome's question. Session storage is cleared when Chrome closes. Settings persist locally:

- the hold key (a letter, or Command/Ctrl);
- the sites where hold-key drag runs or never runs;
- whether you chose to allow all sites;
- your answer to the welcome card;
- your export file-name preferences;
- your theme, and whether it is light, dark or follows the system;
- what releasing a drag does, and the two capture defaults (leave out navigation links, skip links already saved);
- whether to save the words around each link;
- how many pages Follow Next reads at most;
- whether Page details lookup is on.

The side panel and full view also keep the last theme and light or dark choice in their own page storage, so they open in it without a flash.

With all-sites access, the hold-key script is registered on every HTTP(S) site except the ones you exclude. Otherwise it runs only on the sites you enable. When Link Meteor starts, is installed or updated, or applies hold-key settings, it also loads that script into already-open tabs where hold-key drag is on, so those tabs work without a reload.

Deleting a collection removes it from the saved state. Link removal keeps one undo snapshot until superseded or cleared by collection operations. Uninstalling the extension normally removes its extension storage. Back up or export anything you wish to retain before removing it.

**Backing up** downloads one file with every collection, link, note, tag and setting to your browser's download destination; nothing is uploaded. It does not include the removal undo snapshot. Link Meteor keeps the time of your last backup in local storage, to show it in Backup and restore; it keeps nothing about the file itself.

**Restoring** reads a file you choose and shows a preview before anything changes, then merges or replaces. The file is treated as untrusted: links are checked and unknown fields are dropped. After a restore, the previous state is kept once in local storage so the restore can be undone. That copy is kept until the next restore, until you discard it, or until anything else changes. There is no cloud recovery.

## Why permissions are requested

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the page when you invoke the toolbar action, command or context menu. |
| `scripting` | Run the local capture/selection code on an eligible permitted page. |
| `storage` | Keep collections and settings locally and capture context for the session. |
| `sidePanel` | Show review tools alongside the webpage. |
| `contextMenus` | Offer Link Meteor's actions in Chrome's right-click menu and the toolbar icon's menu: select a region, capture this page, save a tab as a link, add or copy a right-clicked link, capture the links in a selection, download a linked file. Chrome tells Link Meteor a right-clicked link's address; to save its exact text, the page script remembers which link was right-clicked, only until a menu item is chosen. |
| `clipboardWrite` | Copy your selected export to the clipboard after an explicit action: a table, URLs, Markdown, rich links (HTML with plain text), or Copy diagnostics. |
| Optional `tabs` | Preview and choose open tabs for multi-tab/window capture. |
| Optional HTTP(S) site access | For selected tabs, Capture this page after its temporary access has ended, hold-key drag, and from 0.6.0 capturing selected pages, including a frame from another site, or getting PDF files through a page of their site, Chrome asks for access one site at a time, naming the sites. You can instead make one explicit choice, **Allow on all sites**: on the welcome card, the Site access switch, or a capture Chrome hid from Link Meteor. Hold-key drag and capture then work on every site except the ones you exclude. |
| Optional `tabGroups` | Name a tab group after your collection when you choose to open links as a group. Without it, the tabs still open in an unnamed group. |
| Optional `downloads` | Save the files behind links you choose (a PDF, an image, a document) into your Downloads folder, as if you had clicked each link. Asked the first time you download. Chrome describes it as "Manage your downloads"; Link Meteor never reads, opens, changes or removes your other downloads. |
| Optional `bookmarks` | Create the bookmark folder you request, or add links to a folder you choose. To show the folder picker, Link Meteor reads your bookmark folder names, and it reads the chosen folder's links to skip ones already there. It never changes or removes other bookmarks. |
| `unlimitedStorage` | Lets large collections, and the Undo kept after a restore, grow past Chrome's default 10 MB extension storage. No prompt; the data stays in this browser. |

**0.6.0 adds no permission and asks for no browser setting.** It does not ask for "Allow access to file URLs" (that setting does not make a PDF on your computer readable; choosing the file needs no access at all), and Link Meteor still does not run in incognito windows.

Multi-tab site access and hold-mode site access are requested when needed. All-sites access is asked for only through the explained choice above, never at install; declining keeps the one-site-at-a-time route. Chrome controls the grant UI and can remove access, including through its own site-access menu. Removing all-sites access (with Link Meteor's Remove Chrome's access button or Chrome's own controls) can also remove Chrome's access to sites you allowed one at a time; Link Meteor then turns hold-key drag off wherever it no longer has access, and asks again when you next capture or turn a site on. Turning off hold mode stops its automatic content-script registration; it does not revoke the broader site permission that may also support multi-tab capture. You can manage/revoke site access through Chrome's extension controls. Revoked origins are removed from hold-mode settings when the permission event is processed.

Downloading a file visits its address with your browser's usual cookies, exactly like clicking the link, and only when you ask. While Link Meteor saves the files you chose, Chrome also asks it to name any other download that starts at the same moment; Link Meteor answers at once, leaves Chrome's own name, and keeps nothing about it. The extension does not request history, cookies, passwords, clipboard reading, network interception, native messaging or incognito access.

## Actions that move data

Copying places the chosen content on the operating-system clipboard. Downloads write your export to the browser's download destination. Bookmarks create browser bookmarks, in a new folder or one you choose; **Chrome may synchronize those bookmarks according to your own browser settings**. Backups are files you download and keep. Opening selected URLs navigates normal tabs and makes ordinary requests to those destinations: up to 500 per action, with a confirmation above 20. These operations happen only at your request and are separate from local collection storage.

**Importing** reads a file you choose (CSV, TSV, Excel, a text or Markdown list, an HTML or bookmarks file, or a Link Meteor JSON export), pasted text, or a Chrome bookmark folder you choose. Files are read in the browser and never uploaded; nothing is added until you confirm the preview, and an import can be undone. Reading a bookmark folder uses the optional bookmarks access, asked for in that click.

**PDFs.** To read the links in a PDF that is open in a tab, Link Meteor asks Chrome for the file again from the same address, as that page. Chrome usually answers from its own cache; otherwise the site is asked again, as when you reload the tab. The PDF is read inside your browser by PDF.js, which is part of Link Meteor. It is never uploaded. A PDF you choose from your computer is read the same way, and Link Meteor needs no access for it.

**Capturing more than one screen or page** happens only when you start it, shows a counter and Stop the whole time, and has a limit stated before it starts:
- *Scroll to the end first* scrolls the page for you, so the page loads the rest of itself as it would if you scrolled. It stops at the end, at 50 screens, at 5,000 links, after 2 minutes, or when you press Stop.
- *Follow Next* moves your tab to the page's own Next link and captures each page, up to the number you set (20 at most). Each page loads as it would if you clicked Next yourself. It stops when there is no Next, at a site Link Meteor can't read, at the limit, or when you press Stop.
- *Capture their pages* opens each page you chose in a background tab, one at a time, saves its links and closes the tab: 20 pages at most, with a pause between pages. Each page loads as it would if you opened it yourself, signed in as you are. Link Meteor asks first for access to the sites it will read, unless you allowed all sites. It never follows the links it finds.

**One ZIP, or one combined PDF.** *Download as one ZIP* and *Combine into one PDF* get each PDF you chose through a page of its own site, as when you click the link, signed in as you are: 20 PDFs at most, one at a time. Where that needs a background tab, Link Meteor asks first for access to the sites it will read, unless you allowed all sites. The files are put together inside your browser by Link Meteor and saved through Chrome's download. They are never uploaded, and Link Meteor keeps no copy.

### Page details lookup

**Citation details and identifiers are not looked up online unless you turn this on.** DOIs, arXiv, PubMed and PMC IDs and ISBNs are read from each link's own address; titles, authors and dates come from the citation tags of pages Link Meteor already has open, and from PDFs it reads.

*Page details lookup* is off unless you turn it on. When it is on and you click *Look up details*, Link Meteor sends the paper's DOI, arXiv ID or PubMed ID, and nothing else, to: Crossref (api.crossref.org) for DOIs; DataCite (api.datacite.org) for DOIs Crossref doesn't have, including arXiv's; and NCBI (eutils.ncbi.nlm.nih.gov) for PubMed IDs. No page address, link text, note or collection name is sent. No cookies are sent or kept. Like any website you visit, those services see your IP address and your browser's version and language. What they return (title, authors, date, journal) is saved in this browser with the link.

The request is made from a sealed frame inside Link Meteor's page. That frame can reach those three addresses and nothing else, cannot read your collections or settings, and is handed only the identifier. It never runs by itself: only when you click, one request at a time, and at most 200 identifiers in a run. Crossref, DataCite and NCBI have their own privacy practices.

Citation exports (BibTeX, RIS, CSL-JSON, an annotated bibliography, an Obsidian note) are built from all of that and from your notes and tags, and are downloaded or copied only when you ask.

A private admin URL can contain sensitive information even without page content. Link Meteor preserves the original rather than silently modifying it, so review exports before sharing. Captured labels are treated as data, escaped in HTML/Markdown and protected against formula interpretation in spreadsheet exports.

The region overlay asks the background for the active collection's name and link count (`collection.active`), and for every collection's name and count (`collections.list`), so its card can say, and let you choose, where links will be saved. This stays inside the extension.

The **About and help** area lists links to the guide, GitHub issues, the website, the source code, the creator's site and optional GitHub Sponsors. They are plain links: nothing is fetched to show them, and a page opens in a new tab only when you click one. Those sites have their own privacy practices. Reporting a bug is a public GitHub issue that you write yourself; Link Meteor never attaches collection data or pages to it.

## The website

The [project website](https://ryanjosephkamp.github.io/link-meteor/) has its own privacy page. It uses no cookies, analytics, advertising or third-party requests; fonts are self-hosted; its demo and export preview run entirely in the visitor's browser. A theme chosen from its menu is kept in that browser's local storage for the site and is never sent anywhere. GitHub Pages hosts the site; GitHub operates those servers under its own privacy statement.

This document describes the current development build. Installation uses the downloadable ZIP and Chrome's Load unpacked option. Browser-store distribution is deferred.
