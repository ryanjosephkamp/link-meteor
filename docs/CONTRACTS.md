# Shared implementation contracts — v1

JavaScript modules use the following exact field names and exports. Pure model/export modules do not reference Chrome, DOM, or Node-only APIs. Changes must preserve compatibility across module consumers and stored schema-v1 collections.

## Data

`Link`: `{id, anchorText, accessibleLabel, url, originalHref, sourceUrl, sourceTitle, frameUrl, capturedAt, batchId, notes, tags}`. All fields except tags are strings; tags is string[]. id is stable for this occurrence. Empty anchorText is meaningful. Capture candidates have the same descriptive fields but no id/batchId/capturedAt/notes/tags; background supplies these.

`Collection`: `{id,name,notes,tags,createdAt,updatedAt,links:Link[]}`.

`State`: `{schemaVersion:1,activeCollectionId,collections:Collection[],settings:{holdKey:'z',holdOrigins:string[],...},undo:null|{collectionId,links:Link[],indices:number[]}}`. Settings added in 0.3.0 are additive schema-v1 fields; see [Settings](#settings-additive-schema-v1-fields).

`CaptureReport`: `{batchId,results:[{tabId,title,url,status:'success'|'denied'|'unsupported'|'error',count,warning,error}],capturedCount}`. Warning/error strings may be empty. Partial results must be retained. Capture script returns `{links:Candidate[], inaccessibleFrames:number, warnings:string[]}`.

## src/core/model.js

Exports:

```js
createState() // fresh valid State with one "My research" collection
reduceState(state, action) // immutable updated valid State; throw descriptive Error on invalid input
queryLinks(links, options = {}) // {rows, matchedCount, occurrenceCount}
```

Reducer actions:

- `{type:'collection.create',name}` creates and activates collection.
- `{type:'collection.activate',id}`.
- `{type:'collection.update',id,patch:{name?,notes?,tags?}}`.
- `{type:'collection.delete',id}` removes only that collection, retaining/creating a valid active collection.
- `{type:'links.append',collectionId?,links:Link[]}` validates and appends occurrences (duplicate IDs rejected/skipped deterministically, not duplicate URLs); default active collection.
- `{type:'links.remove',collectionId?,ids:string[]}` saves one undo snapshot for removed occurrences.
- `{type:'links.undo'}` restores removed occurrences at original positions and clears undo.
- `{type:'link.update',collectionId?,id,patch:{notes?,tags?}}`.
- `{type:'settings.update',patch:{holdKey?,holdOrigins?}}` validates single alphabetic hold key and HTTP(S) origins.

`queryLinks` options: `{search:'',domain:'',fileType:'',relation:'all'|'internal'|'external',sort:'page'|'anchor'|'url'|'domain'|'newest',direction:'asc'|'desc',dedupe:'none'|'url'|'url-anchor'}`. Default page preserves stored order. Search checks anchorText/url/sourceTitle/sourceUrl/notes/tags. Domain substring matches destination hostname; fileType uses pathname suffix without dot (pdf, html etc). Internal means same hostname as source URL. Unknown relation is neither internal nor external.

Each result row is a representative `Link` extended with `occurrences:Link[]` and `occurrenceIds:string[]`. `matchedCount` is filtered occurrence count before dedupe, `occurrenceCount` is total input length. Grouped rows preserve all matching occurrences. Never mutate inputs.

## src/core/export.js

```js
export const COLUMNS = [ {key:'anchorText',label:'Anchor text'}, /* all Link metadata fields useful for export, including url */ ];
makeExport(rows, {format, columns = ['anchorText','url']})
// => {data: string|Uint8Array, mime: string, extension: string}
```

Formats exactly `csv`, `tsv`, `text`, `markdown`, `html`, `json`, `xlsx`. UI uses tsv for two-column clipboard, text for URLs, markdown for linked labels. CSV/TSV/XLSX honor columns in given order. CSV/TSV protect formula-like strings. XLSX uses string cells and valid ZIP/OOXML. JSON preserves row provenance and grouped occurrences regardless of selected columns. HTML/Markdown escape labels and URL syntax. text is URLs separated by newlines. Empty columns or unsupported keys/formats throw useful errors.

## Browser message API

All UI requests use `chrome.runtime.sendMessage(message)` and receive `{ok:true,data}` or `{ok:false,error:string}`. Every request uses a `type` below; error envelope must be handled.

- `state.get` => State.
- `settings.get` => the saved settings, with `holdOrigins` limited to origins Chrome still grants. Read-only; allowed from content scripts so a page's hold-key script can configure itself.
- `state.mutate`, `{action}` => State, after successful storage write.
- `tabs.list` => `{tabs:[{id,windowId,title,url,active}],currentWindowId,targetTabId}`. UI asks optional `tabs` permission before multi-tab inventory.
- `capture.run`, `{tabIds:number[]}` => `{state,report:CaptureReport}`. Empty tabIds means current page. UI requests optional origins for explicit multi-tab choices before calling; background never prompts.
- `capture.arm`, `{tabId?:number}` => `{tabId}`. Uses activeTab or granted host permission; forbidden pages return error.
- `capture.commit`, `{links:Candidate[],inaccessibleFrames?:number,review?:boolean}` => `{state,count,warning}`; a Review-open failure returns a successful save plus warning. Only accept from a content-script sender with a tab. review opens full workbench.
- `ui.open` => `{}`; opens full extension workbench tab.
- `collection.active` => `{name, count}` for the active collection. Read-only; allowed from content scripts so the region overlay can name its destination (added in 0.2.0).
- `links.open`, `{urls:string[]}` => `{opened:number,failed:number}`. HTTP(S) only; maximum 20 per request, reject larger input explicitly.
- `links.bookmark`, `{name:string,links:[{anchorText,url}]}` => `{folderId,count,failed}`. UI requests optional bookmarks permission before calling.
- `hold.configure`, `{origin:string,enabled:boolean,key:string}` => State. UI requests that exact origin first when enabling. Background registers/unregisters host-scoped content script and persists settings.

State updates also emit `chrome.runtime.sendMessage({type:'state.changed'})`; UI reloads state and may also watch chrome.storage.onChanged for `linkMeteorState` to recover missed notifications. Do not treat these notifications as user requests.

UI source scope `current`, `selected`, `window`, `all` is resolved by UI from tabs.list/currentWindowId; extension/internal tabs are visibly unsupported in capture results rather than scanned. Tab list includes ordinary windows only. Origin grants use `origin + '/*'` for HTTP(S).

Content capture script installs `globalThis.__linkMeteor = {scan,arm}` in its isolated world, once per document. `scan()` returns the capture result synchronously. `arm()` installs selection UI. Background injects `content/capture.js` and invokes these methods with scripting.executeScript. It accepts `content.configure` messages `{holdKey,enabled}` for immediate hold-mode settings; dynamically registered scripts can obtain settings via `state.get`. All content-created UI is marked and excluded from extraction.

Latest capture reports are retained at session key `linkMeteorCaptureReport` as `{report,createdAt}`. The UI freezes the originally selected tab IDs before a host-permission request; survivors are checked for origin drift, closed IDs remain for explicit error results, and newly opened tabs are excluded from that capture.

## Workbench UI notes (0.2.0)

Element IDs used by the browser suites are stable: `#collection-heading`, `#new-collection`/`#create-collection`, `input[name=scope]`, `#tab-options`, `#capture`, `#capture-report`, `#site-origin`, `#search`, `#domain`, `#file-type`, `#relation`, `#sort`, `#direction`, `#dedupe`, `.link-row`, `.row-select`, `.row-details summary`, `.occurrence`, `#select-all`, `#selection-count`, `#page-prev`/`#page-next`/`#page-range`, `#remove`, `#undo`, `#format`, `#download`, `#copy-table`/`#copy-urls`/`#copy-markdown`, `#bookmark-name`, `#bookmark`, `#open-links`, `#hold-key`, `#hold-enabled`, `#notice`, `#error`. The collection editor (`#edit-collection`) and view options (`#filters-toggle`) are disclosures that must be opened before their fields are visible. Opening links uses an inline confirmation (`#open-confirm-yes`) instead of `window.confirm`. The overlay keeps `.badge`, `.count`, `.status` and the button names Copy text + URL, Add to collection, Review, Add another region, Close captured links.

About and help (0.2.2): `#about-panel` is a `<details>` disclosure in the rail, closed by default, with `#about-summary`, `#about-version` and `#about-version-full` (both read from the manifest). `#help-toggle` in the header opens it; below 900 px it first switches to the collections view, then focuses `#about-summary`. Its six links (personal site, guide, issues, website, source, Sponsors) are ordinary `target=_blank rel="noopener noreferrer"` links. It adds no permission, message type or storage key.

## Planned for 0.3.0

Everything in this section is a contract for work in progress, not a shipped feature. [ACCEPTANCE.md](ACCEPTANCE.md) records what a release actually contains. Where a planned contract changes an existing message, the existing description above stays accurate for 0.2.2 until the change ships.

### Settings: additive schema-v1 fields

The storage schema stays version 1. Version 0.2.2 keeps unknown settings fields when it writes, so a state with these fields survives a downgrade, while a new schema version would make 0.2.2 refuse the saved data. Collections, links and the removal undo snapshot are unchanged.

| Field | Type and default | Meaning |
| --- | --- | --- |
| `holdKey` | one letter, `'z'` | Unchanged. The letter held for hold-drag while `holdTrigger` is `'letter'`. Kept while the trigger is `'modifier'`, so switching back restores it. |
| `holdOrigins` | HTTP(S) origins, `[]` | Unchanged. Sites where hold-drag runs while `holdScope` is `'sites'`. |
| `holdTrigger` | `'letter'` or `'modifier'`, `'letter'` | `'modifier'` is Command on macOS and Ctrl elsewhere. Option/Alt and Shift are not offered. |
| `holdScope` | `'sites'` or `'all'`, `'sites'` | `'all'` runs hold-drag on every HTTP(S) site except `holdExceptions`, and needs Chrome's all-sites access. |
| `holdExceptions` | HTTP(S) origins, `[]`, at most 1,000 | "Never on these sites": hold-drag does not run there in either scope. |
| `welcomeSeen` | boolean, `false` | The first-run welcome card was answered or dismissed. Upgrading installs see the card once. |
| `exportPrefix` | string, `''`, at most 40 characters | Optional prefix for default export names. Stored already safe: it must equal `fileNamePart(value, 40)`. |
| `exportTimestamp` | boolean, `true` | Add the export date to default file names. |
| `exportTimestampFormat` | `'datetime'` or `'date'`, `'datetime'` | Date and time (`YYYY-MM-DD_HHmm`) or date only. |

- `SETTINGS_DEFAULTS` in `src/core/model.js` lists every field. A later field needs a default there and a check in `settingsField`; the migration then covers it.
- `migrateState(state)` fills only absent fields. Present values, collections, links and the undo snapshot are kept exactly, and an up-to-date state is returned as the same object. The background applies it on every read, `reduceState` applies it before validating, and the next write stores the result. A present but invalid value is reported, never replaced.
- `settings.update` accepts every field above. A site cannot be in both `holdOrigins` and `holdExceptions`: moving one means sending both lists in one patch.
- Unknown settings fields in saved state are kept through writes; a backup reader drops them (below).

### Backup file, format 1

A backup is UTF-8 JSON; formatting is not significant.

```js
{format:'link-meteor-backup', formatVersion:1, createdAt:string, extensionVersion:string,
 state:{schemaVersion:1, activeCollectionId, collections:Collection[], settings:Settings}}
```

`src/core/model.js` exports:

```js
createBackup(state, {createdAt?, extensionVersion?}) // backup object; read back before it is returned
readBackup(textOrObject)                          // validated backup in the current format, or a readable Error
planRestore(state, backup, 'merge'|'replace')     // {state, summary}; saves nothing
// reducer action {type:'backup.restore', backup, mode:'merge'|'replace'} saves planRestore(...).state
```

- The removal undo snapshot is not backed up.
- Reading treats the file as untrusted. The file must name the format, a known `formatVersion` (a newer one is refused with a message to update Link Meteor) and schema 1. Every link passes the same checks as a capture: HTTP(S), `mailto:` or `tel:` URLs only, strings everywhere, nonempty unique IDs. Collection IDs are unique and the active collection exists. Settings are checked as above, and missing ones take defaults. Only contract fields are kept: extra properties, including `__proto__`, never reach saved objects. Text is kept exactly, so formula-like and markup labels stay inert data. Limits: 50 MB of text (extension messages carry at most 64 MiB), 10,000 collections and 250,000 links.
- A release that adds stored fields must raise `BACKUP_FORMAT_VERSION`, so older releases refuse the file instead of silently dropping data.
- **Merge.** A backup collection joins the local collection with the same ID, else the first with the same trimmed name, else it is added with its own ID, dates and order. A fresh install's empty "My research" therefore absorbs the backup's "My research" instead of duplicating it. Links append in backup order. A link whose occurrence ID is already saved, or held for removal Undo, is skipped, so restoring the same file twice adds nothing, and local edits to that occurrence win. Local names, nonempty notes, the active collection, the removal undo and single-value settings are kept. Tags and both site lists are combined, and a site already on one local list is not added to the other.
- **Replace.** The backup's collections, active collection and settings replace local ones, and the removal undo is cleared. `welcomeSeen` stays true if either side has it.
- `summary`: `{mode, backupCreatedAt, backupExtensionVersion, collectionsInBackup, linksInBackup, collectionsAdded, collectionsMatched, linksAdded, linksSkipped, collectionsRemoved, linksRemoved, settingsChanged:string[]}`.
- Backup download name: `link-meteor-backup_<YYYY-MM-DD>_<HHmm>.json`, whatever the export name settings are.

### Export file names

`src/core/export.js` exports `exportFileName({collection, extension, settings, date, override})` and `fileNamePart(text, max = 80)`.

- The default is `<prefix_><collection>_<YYYY-MM-DD>_<HHmm>.<ext>` in local time with no colons, for example `Urban-heat-islands-sources_2026-09-26_1432.xlsx`. With `exportPrefix` set to `link-meteor-research`, that becomes `link-meteor-research_Urban-heat-islands-sources_2026-09-26_1432.xlsx`. `exportTimestamp: false` drops the date and time; `exportTimestampFormat: 'date'` drops the time.
- `override` is the Export panel's File name field for one export. When it contains anything usable, it replaces the pattern, and a typed matching extension is not doubled.
- `fileNamePart` folds accents to plain letters and turns every run of other characters outside letters, digits, `.`, `_` and `-` into one hyphen. It removes leading and trailing dots and hyphens and cuts to `max`. An empty collection name becomes `links`, and Windows device names (`CON`, `NUL`, `COM1` and so on) get a trailing underscore.
- The Export panel and the capture card's download both use this function.

### Export content

- `makeExport(rows, {format, columns, about})` stays compatible: without `about`, every format is byte-for-byte what 0.2.2 produces.
- With `about` (`{exportedAt: Date, collection, count, view, filters: string[], columns, version}`), XLSX adds a second sheet, About, with the export time in local time and UTC, the collection, the link count, the view (grouping and sort) and filters, the columns and the Link Meteor version. JSON becomes `{about: {...}, rows: [...]}`, and `rows` is exactly the 0.2.2 array.
- The formatted XLSX first sheet has a bold header row that stays visible while scrolling, filter buttons and column widths fitted to the content. HTTP(S) and `mailto:` URLs are clickable through sheet hyperlinks, never `HYPERLINK` formulas, and the cell text stays the exact URL. Every cell stays a string, with no formulas anywhere.
- CSV and TSV stay plain and unchanged.

### Messages

These keep the envelope and sender rules of the Browser message API above. "Workbench" means the request is accepted only from Link Meteor's own pages; "page" means it comes from the capture script, with a sender tab. Permission prompts happen only in an extension page's click handler, with no `await` before `chrome.permissions.request`, so the gesture is not lost. The background never prompts.

**All-sites access and the hold key**

- `hold.scope`, `{scope:'sites'|'all'}` => State. Workbench. Before sending `'all'`, the page requests `{origins:['http://*/*','https://*/*']}` in the same click: from the welcome card's "Allow on all sites (recommended)" or the settings switch. The background refuses `'all'` unless both patterns are granted. In `'all'`, one persistent content script covers both patterns, with `excludeMatches` built from `holdExceptions`. Switching back to `'sites'` keeps Chrome's grant; the page may offer to remove it with `chrome.permissions.remove`.
- `hold.exception`, `{origin, excepted:boolean}` => State. Workbench. Adds the origin to `holdExceptions` (and removes it from `holdOrigins`), or takes it off the list, then re-registers and reconfigures that origin's open tabs. In `'all'` scope, the This site toggle sends this message; in `'sites'` scope it keeps using `hold.configure`, which now also takes an origin off `holdExceptions` when turning it on.
- `hold.settings`, `{trigger?:'letter'|'modifier', key?:letter}` => State. Workbench. Saves the trigger and letter, then sends `content.configure` to every tab where hold-drag runs.
- `content.configure` (background to page) gains `holdTrigger`: `{holdKey, holdTrigger, enabled}`.
- Hold-drag rules. With `'modifier'`, a plain Command-click or Ctrl-click passes through untouched. Selection starts only after the pointer moves at least 6 CSS pixels with the modifier and the primary button held, and the click that ends that drag is suppressed once. Editable targets never start a selection, and no page event is cancelled before the threshold.
- Keeping access honest. On install, on startup, when permissions are added or removed, and after any saved write that changes `holdScope`, `holdOrigins`, `holdExceptions`, `holdKey` or `holdTrigger` (including a restore and its Undo), the background does four things: it removes origins Chrome no longer grants, sets `holdScope` to `'sites'` if all-sites access is gone, re-registers content scripts and reconfigures open tabs. It follows writes through `onStateWritten` in `src/background/store.js`. When Chrome's own site-access menu withholds a site, capture reports it as denied, and the page explains that menu.
- *Capture this page*. With the This page scope, when neither all-sites access nor the tab's origin is granted, the capture click first requests `{origins:[origin + '/*']}`, then runs `capture.run`. A declined request still runs the capture and reports it as denied, with the reason.

**Opening many links**

- `links.open`, `{urls, confirmed?, mode?:'tabs'|'window'|'group', groupTitle?, requestId?}` => `{opened, failed, cancelled, windowId?, groupId?, groupTitled?}`. Workbench. HTTP(S) only; 1 to 500 URLs; more than 500 is refused. More than 20 requires `confirmed:true`. The page confirms inline above 20 (Open N, Open in a new window, Cancel) and uses stronger wording above 100. Tabs open in the background in batches of at most 10, with a pause between batches. `'window'` opens a new focused window. `'group'` puts the new tabs in one tab group; naming it with `groupTitle` (the collection name) needs the optional `tabGroups` permission, which the page requests when the person chooses a group. Without it, the group stays unnamed and `groupTitled` is false.
- `links.progress` (background to pages; a notification, not a request): `{type:'links.progress', requestId, opened, failed, total}` after each batch.
- `links.cancel`, `{requestId}` => `{cancelled:boolean}`. Workbench. Stops before the next batch; tabs already opened stay open.

**The capture card**

- Every card action uses only the links still ticked in the card's preview.
- `collections.list` => `{activeCollectionId, collections:[{id, name, count}]}`. Any sender, read-only: names and counts only, for the destination picker on the "Adds to" line.
- `capture.commit` gains `collectionId?`: the chosen destination, which must still exist; otherwise nothing is saved and the card says so.
- `capture.copy` gains `format?: 'tsv'|'text'|'markdown'` (default `'tsv'`) => `{text}`. Page.
- `capture.open`, `{links, mode?, confirmed?}` => as `links.open`. Page. The group title is the destination collection's name. The card shows its own confirmation above 20.
- `capture.export`, `{links, format, collectionId?}` => `{fileName, mime, encoding:'utf8'|'base64', data}`. Page. XLSX is base64. `fileName` comes from `exportFileName` with the destination collection and the saved settings; the card saves it with a download link inside its own shadow root.
- `capture.bookmark`, `{links, name?}` => as `links.bookmark`. Page. It works only when bookmark access is already granted, because a page cannot show Chrome's prompt. Otherwise the error begins "Bookmark access is needed", and the card offers to open the full view.
- `ui.open` gains `{view?:'links'|'export', batchId?}`. The background keeps it at session key `linkMeteorOpenIntent`; the workbench applies it once (showing only that capture, and the export view at compact widths), then removes it.
- Each card action has a one-letter keyboard shortcut shown in its tooltip. The shortcuts work only while focus is inside the card, never while typing in the page.

**Bookmark folders**

- `bookmarks.folders` => `{folders:[{id, title, path, depth}]}`. Workbench. Every bookmark folder in tree order, without the invisible root; `path` joins ancestor titles with " › ". Needs bookmark access, which the page requests when the person chooses "Existing folder".
- `links.bookmark` becomes `{links, name?, folderId?, skipExisting? = true}` => `{folderId, created, count, skipped, failed}`. Exactly one of `name` (a new folder under Other bookmarks, as today) or `folderId` (an existing folder, not a bookmark) is required. `skipExisting` skips a link whose exact URL is already a direct child of the folder, including one added earlier in the same action. A textless link still uses its URL as the title.

**Backup and restore**

- Backing up needs no message. The workbench builds the file from its loaded state with `createBackup` and downloads it like an export.
- The restore preview needs no message. The workbench reads the file, calls `planRestore` for merge and for replace, and shows both summaries. It also names hold-drag sites that would need Chrome's access again.
- `backup.restore`, `{backup, mode:'merge'|'replace'}` => `{state, summary}`. Workbench. Validates, plans and saves inside the state queue. The new state and the Undo snapshot are saved in one storage write through `writeState`, at local key `linkMeteorRestoreUndo`: `{createdAt, summary, before:State}`. A failure changes nothing.
- `backup.undo` => `{state}`. Workbench. Puts back `before` only while the saved state is still the one the restore wrote; otherwise it reports that Link Meteor changed since, and keeps both. Undo clears the snapshot.
- `backup.status` => `{undo: null | {createdAt, summary}}`. `backup.discardUndo` => `{}`. The snapshot is also replaced by the next restore.
- The required `unlimitedStorage` permission raises Chrome's 10 MB extension storage limit, so large collections and the Undo snapshot fit. It shows no prompt.

**Selecting and removing**

- No new messages. On a single page the page checkbox is labeled "Select all". With more than one page, a "Select all N" button is always visible. "Remove all in this view" asks for inline confirmation, then sends `links.remove` with every occurrence in the view, keeping the existing Undo. "Empty this collection" in the collection editor does the same for every link in the collection.

### Storage keys

| Area | Key | Contents |
| --- | --- | --- |
| local | `linkMeteorState` | State (unchanged). |
| local | `linkMeteorRestoreUndo` | Planned: the restore Undo snapshot above. |
| session | `linkMeteorTarget`, `linkMeteorCaptureReport`, `linkMeteorCaptureReportDismissed`, `linkMeteorActivationError` | Unchanged. |
| session | `linkMeteorOpenIntent` | Planned: `{view, batchId, createdAt}` from `ui.open`. |

### Permissions

| Permission | Change | When it is asked for |
| --- | --- | --- |
| Optional `http://*/*` and `https://*/*` | Already declared; newly requested as one choice | From the welcome card or the settings switch, never at install. |
| Optional `tabGroups` | New | When the person first chooses to open links as a named tab group. |
| `unlimitedStorage` | New, required | No prompt. |

Every permission also needs a reason in the UI, in [PRIVACY.md](PRIVACY.md) and in `CHROMEWEBSTORE.md` before it ships. Extension pages keep `connect-src 'none'`.

### Stable element IDs for 0.3.0 suites

Mount points already in `ui/workbench.html`, hidden and empty until built: `#welcome` (top of the main column) and `#backup-panel` (in the rail, before About and help). Planned IDs:

- Welcome and access: `#welcome-allow`, `#welcome-later`, `#all-sites`, `#hold-trigger`, `#hold-exceptions`, `#site-exception`.
- Opening: `#open-confirm` and `#open-confirm-yes` (existing), `#open-confirm-window`, `#open-confirm-group`, `#open-cancel-progress`.
- Export: `#export-name`, `#name-prefix`, `#name-timestamp`, `#name-timestamp-format`, `#bookmark-mode`, `#bookmark-folder`, `#bookmark-skip-existing`.
- Backup: `#backup-download`, `#backup-file`, `#restore-preview`, `#restore-merge`, `#restore-replace`, `#restore-cancel`, `#restore-undo`.
- Review: `#select-all` and `#select-everything` (existing), `#remove-view`, `#remove-view-confirm`, `#empty-collection`, `#empty-confirm`.

## Code layout (0.3.0)

The workbench entry `ui/workbench.js` binds each area and runs start-up in a fixed order. Area modules live in `ui/workbench/`:

| Module | Responsibility |
| --- | --- |
| `helpers.js` | DOM, formatting and URL helpers; no UI state. |
| `state.js` | The shared `ui` object, background requests, notices, `mutate` and state reloads. |
| `rendering.js` | The render pass, compact views and page keys. `onRender(hook)` adds to every render after the built-in sections; `onEscape(handler)` lets a confirmation claim Escape, in binding order. |
| `collections.js` | The header, the rail list, create, switch, edit and delete. |
| `review.js` | Filters, the link list, occurrence details, selection, removal and Undo, and `targetRows()`/`requiredRows()`, the rows an action uses. |
| `capture.js` | Scope and tab inventory, running a capture and the capture report. |
| `open.js` | Opening links, with confirmation. |
| `export.js` | Format, columns, the export target, downloads and copies. |
| `bookmarks.js` | Bookmark folders. |
| `settings.js` | Hold key, this site and the region shortcut. |
| `about.js` | Version and help. |

The service worker entry `background.js` owns capture, hold-key registration, opening links and Chrome events. Shared pieces live in `background/`:

- `store.js`: the serialized state queue, `readState`, `mutate`, `writeState(previous, next, extra)` and `onStateWritten(listener)`.
- `urls.js`: URL rules.
- `bookmarks.js` and `backup.js`: each exports `workbenchMessages`, a table of workbench-only message handlers. The entry routes them and refuses a type claimed twice.

The release contains the fixed files named in `scripts/release-files.mjs`, plus any `.js` or `.css` modules in `ui/workbench/` and `background/`. Any other file in `src/` stops the build.
