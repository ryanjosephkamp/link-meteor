# Link Meteor privacy and permissions

Link Meteor processes captured links locally in Chrome. It has no account, remote service, analytics, advertisements, telemetry or paid functionality. Packaged extension pages do not contact a server. Capturing a link does not visit its destination.

## What is stored

Named collections contain visible anchor text, separately labeled accessible text, destination URLs, original hrefs, source page URLs/titles, frame URLs, capture times/batch IDs and your notes/tags. These are stored in `chrome.storage.local` in the current browser profile. Collection data is not placed in Chrome Sync by this extension. Chrome's profile backup or operating-system backup behavior is separate.

The current invoking tab and latest capture report are kept in session storage so separate views can show the same result. The session report can be dismissed. Settings persist locally:

- the hold key (a letter, or Command/Ctrl);
- the sites where hold-key drag runs or never runs;
- whether you chose to allow all sites;
- your answer to the welcome card;
- your export file-name preferences.

With all-sites access, the hold-key script is registered on every HTTP(S) site except the ones you exclude. Otherwise it runs only on the sites you enable. When Link Meteor starts, is installed or updated, or applies hold-key settings, it also loads that script into already-open tabs where hold-key drag is on, so those tabs work without a reload.

Deleting a collection removes it from the saved state. Link removal keeps one undo snapshot until superseded or cleared by collection operations. Uninstalling the extension normally removes its extension storage. Back up or export anything you wish to retain before removing it.

**Backing up** downloads one file with every collection, link, note, tag and setting to your browser's download destination; nothing is uploaded. It does not include the removal undo snapshot.

**Restoring** reads a file you choose and shows a preview before anything changes, then merges or replaces. The file is treated as untrusted: links are checked and unknown fields are dropped. After a restore, the previous state is kept once in local storage so the restore can be undone. That copy is kept until the next restore, until you discard it, or until anything else changes. There is no cloud recovery.

## Why permissions are requested

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the page when you invoke the toolbar action, command or context menu. |
| `scripting` | Run the local capture/selection code on an eligible permitted page. |
| `storage` | Keep collections and settings locally and capture context for the session. |
| `sidePanel` | Show review tools alongside the webpage. |
| `contextMenus` | Offer regional and page capture from Chrome's context menu. |
| `clipboardWrite` | Copy your selected export to the clipboard after an explicit action. |
| Optional `tabs` | Preview and choose open tabs for multi-tab/window capture. |
| Optional HTTP(S) site access | For selected tabs, Capture this page after its temporary access has ended, or hold-key drag, Chrome asks for access one site at a time. You can instead make one explicit choice, **Allow on all sites**: on the welcome card, the Site access switch, or a capture Chrome hid from Link Meteor. Hold-key drag and capture then work on every site except the ones you exclude. |
| Optional `tabGroups` | Name a tab group after your collection when you choose to open links as a group. Without it, the tabs still open in an unnamed group. |
| Optional `bookmarks` | Create the bookmark folder you request, or add links to a folder you choose. To show the folder picker, Link Meteor reads your bookmark folder names, and it reads the chosen folder's links to skip ones already there. It never changes or removes other bookmarks. |
| `unlimitedStorage` | Lets large collections, and the Undo kept after a restore, grow past Chrome's default 10 MB extension storage. No prompt; the data stays in this browser. |

Multi-tab site access and hold-mode site access are requested when needed. All-sites access is asked for only through the explained choice above, never at install; declining keeps the one-site-at-a-time route. Chrome controls the grant UI and can remove access, including through its own site-access menu. Removing all-sites access (with Link Meteor's Remove Chrome's access button or Chrome's own controls) can also remove Chrome's access to sites you allowed one at a time; Link Meteor then turns hold-key drag off wherever it no longer has access, and asks again when you next capture or turn a site on. Turning off hold mode stops its automatic content-script registration; it does not revoke the broader site permission that may also support multi-tab capture. You can manage/revoke site access through Chrome's extension controls. Revoked origins are removed from hold-mode settings when the permission event is processed.

The extension does not request history, cookies, passwords, clipboard reading, network interception, native messaging or incognito access.

## Actions that move data

Copying places the chosen content on the operating-system clipboard. Downloads write your export to the browser's download destination. Bookmarks create browser bookmarks, in a new folder or one you choose; **Chrome may synchronize those bookmarks according to your own browser settings**. Backups are files you download and keep. Opening selected URLs navigates normal tabs and makes ordinary requests to those destinations: up to 500 per action, with a confirmation above 20. These operations happen only at your request and are separate from local collection storage.

A private admin URL can contain sensitive information even without page content. Link Meteor preserves the original rather than silently modifying it, so review exports before sharing. Captured labels are treated as data, escaped in HTML/Markdown and protected against formula interpretation in spreadsheet exports.

The region overlay asks the background for the active collection's name and link count (`collection.active`), and for every collection's name and count (`collections.list`), so its card can say, and let you choose, where links will be saved. This stays inside the extension.

The **About and help** area lists links to the guide, GitHub issues, the website, the source code, the creator's site and optional GitHub Sponsors. They are plain links: nothing is fetched to show them, and a page opens in a new tab only when you click one. Those sites have their own privacy practices. Reporting a bug is a public GitHub issue that you write yourself; Link Meteor never attaches collection data or pages to it.

## The website

The [project website](https://ryanjosephkamp.github.io/link-meteor/) has its own privacy page. It uses no cookies, analytics, advertising or third-party requests; fonts are self-hosted; its demo and export preview run entirely in the visitor's browser. GitHub Pages hosts the site; GitHub operates those servers under its own privacy statement.

This document describes the current development build. Installation uses the downloadable ZIP and Chrome's Load unpacked option. Browser-store distribution is deferred.
