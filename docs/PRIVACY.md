# Link Meteor privacy and permissions

Link Meteor processes captured links locally in Chrome. It has no account, remote service, analytics, advertisements, telemetry or paid functionality. Packaged extension pages do not contact a server. Capturing a link does not visit its destination.

## What is stored

Named collections contain visible anchor text, separately labeled accessible text, destination URLs, original hrefs, source page URLs/titles, frame URLs, capture times/batch IDs and your notes/tags. These are stored in `chrome.storage.local` in the current browser profile. Collection data is not placed in Chrome Sync by this extension. Chrome's profile backup or operating-system backup behavior is separate.

The current invoking tab and latest capture report are kept in session storage so separate views can show the same result. The session report can be dismissed. Local hold-key preferences persist; only explicitly enabled permitted origins receive the hold-key content script.

Deleting a collection removes it from the saved state. Link removal keeps one undo snapshot until superseded or cleared by collection operations. Uninstalling the extension normally removes its extension storage. Export anything you wish to retain before removing it. The extension does not provide cloud recovery or an import/restore flow in version one.

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
| Optional HTTP(S) site access | Capture selected tabs or enable hold-key mode on the requested sites. |
| Optional `bookmarks` | Create the bookmark folder you request. |

Multi-tab site access and hold-mode site access are requested when needed. Chrome controls the grant UI and can remove access. Turning off hold mode stops its automatic content-script registration; it does not revoke the broader site permission that may also support multi-tab capture. You can manage/revoke site access through Chrome's extension controls. Revoked origins are removed from hold-mode settings when the permission event is processed.

The extension does not request history, cookies, passwords, clipboard reading, network interception, native messaging or incognito access.

## Actions that move data

Copying places the chosen content on the operating-system clipboard. Downloads write your export to the browser's download destination. Bookmarks create browser bookmarks; **Chrome may synchronize those bookmarks according to your own browser settings**. Opening selected URLs navigates normal tabs and makes ordinary requests to those destinations. These operations happen only at your request and are separate from local collection storage.

A private admin URL can contain sensitive information even without page content. Link Meteor preserves the original rather than silently modifying it, so review exports before sharing. Captured labels are treated as data, escaped in HTML/Markdown and protected against formula interpretation in spreadsheet exports.

The region overlay asks the background for the active collection's name and link count (`collection.active`) so its card can say where links will be saved. This stays inside the extension.

The **About and help** area lists links to the guide, GitHub issues, the website, the source code, the creator's site and optional GitHub Sponsors. They are plain links: nothing is fetched to show them, and a page opens in a new tab only when you click one. Those sites have their own privacy practices. Reporting a bug is a public GitHub issue that you write yourself; Link Meteor never attaches collection data or pages to it.

## The website

The [project website](https://ryanjosephkamp.github.io/link-meteor/) has its own privacy page. It uses no cookies, analytics, advertising or third-party requests; fonts are self-hosted; its demo and export preview run entirely in the visitor's browser. GitHub Pages hosts the site; GitHub operates those servers under its own privacy statement.

This document describes the current development build. Installation uses the downloadable ZIP and Chrome's Load unpacked option. Browser-store distribution is deferred.
