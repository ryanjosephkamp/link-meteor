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

## Added in 0.3.0

These contracts were written before 0.3.0 was built and are now implemented on the 0.3.0 build, not yet released. [ACCEPTANCE.md](ACCEPTANCE.md) records what a release contains and how it was tested. Where 0.3.0 changes an existing message, the description above stays accurate for 0.2.2 and this section describes 0.3.0.

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

- `hold.scope`, `{scope:'sites'|'all'}` => State. Workbench. Before sending `'all'`, the page requests `{origins:['http://*/*','https://*/*']}` in the same click: from the welcome card's "Allow on all sites (recommended)" or the settings switch. The background refuses `'all'` unless both patterns are granted. In `'all'`, one persistent content script covers both patterns, with `excludeMatches` built from `holdExceptions`. Switching back to `'sites'` keeps Chrome's grant; the page may offer to remove it with `chrome.permissions.remove`. Removing `http://*/*` and `https://*/*` also removes narrower site grants they cover (observed in Chrome for Testing 151), so the upkeep then clears those sites from `holdOrigins`.
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
- `backup.restore`, `{backup, mode:'merge'|'replace'}` => `{state, summary}`. Workbench. Validates, plans and saves inside the state queue. The new state and the Undo snapshot are saved in one storage write through `writeState`, at local key `linkMeteorRestoreUndo`: `{createdAt, summary, before:State, written}`. `written` lets Undo check that the saved state is still the one the restore wrote: `{fingerprint, holdOrigins, holdScope}`, where `fingerprint` is a SHA-256 of the saved state as canonical JSON without those two fields. A failure changes nothing.
- `backup.undo` => `{state}`. Workbench. Puts back `before` only while the saved state is still the one the restore wrote; otherwise it reports that Link Meteor changed since, and keeps both. The background's own access upkeep does not count as a change. That upkeep only removes hold-drag sites that Chrome no longer grants, in order, or sets `holdScope` back to `'sites'`. Adding a site or turning all-sites mode on does count. Undo clears the snapshot.
- `backup.status` => `{undo: null | {createdAt, summary}}`. `backup.discardUndo` => `{}`. The snapshot is also replaced by the next restore.
- The required `unlimitedStorage` permission raises Chrome's 10 MB extension storage limit, so large collections and the Undo snapshot fit. It shows no prompt.

**Selecting and removing**

- No new messages. On a single page the page checkbox is labeled "Select all". With more than one page, a "Select all N" button is always visible. "Remove all in this view" asks for inline confirmation, then sends `links.remove` with every occurrence in the view, keeping the existing Undo. "Empty this collection" in the collection editor does the same for every link in the collection.

### Details settled while building

**Access and capture**

- `capture.open` also takes `collectionId?`, the card's destination, used for the group title, and `requestId?`. Its `links.progress` notifications go to the sender tab. `links.cancel` is accepted from a page only for openings that tab started.
- `settings.get` reports `holdScope: 'sites'` while Chrome no longer grants all sites; the saved value is corrected by the next access upkeep.
- `capture.commit` with `review: true` stores the open intent `{view:'links', batchId}`, so the full view shows that capture.
- Hold-drag with the modifier: Chrome starts a native link or image drag after 4 pixels, before the 6-pixel threshold, so `dragstart` is cancelled while a modifier press may still become a selection. No other page event is cancelled before 6 pixels.
- A `hold.*` request whose settings were saved but whose script registration Chrome refused returns an error saying the settings were saved; open tabs are still reconfigured.
- With the tabs permission, the workbench checks whether the current page can be read by running an empty script there. Without it, a visible address already means the page is readable.
- Page scripts listen for saved changes only while a capture card is open; hold settings reach open tabs through `content.configure`.
- The page script's `globalThis.__linkMeteor` also has `alive()` and `dispose()`. `alive()` is true while the copy can still reach the extension; `dispose()` removes its listeners and overlay. When the script loads, a live copy already in the page stays and the new one exits. A copy that is not alive, or one from an earlier build without `alive()`, is disposed where possible and replaced.
- On install, update and startup, the sync loads the page script into open tabs where hold-drag runs (`inject: 'all'`). Every sync also loads it into a tab where hold-drag should run but where no script answers `content.configure`. A page that begins loading while the extension starts can miss the registered script; 0.3.0 release candidate 1 found one, and release candidate 2 tests it.
- The all-sites switch keeps showing the person's choice while that choice is being saved, and shows the saved state again once the save succeeds or fails.
- *Capture this page* when Chrome hides the tab's address, with no tabs permission and no site access: there is no single site to ask for. The capture still runs and is reported as denied with the reason. The result also offers "Allow on all sites": the welcome card's request, asked in that click. If Chrome grants it, the scope becomes `'all'`, `welcomeSeen` becomes true and the page is captured again.

**Exports and bookmarks**

- `bookmarks.folders` paths run from the top-level folder down to and including the folder itself. An untitled folder appears as "(untitled folder)" in `path`, while its `title` stays empty. Folders Chrome manages by policy can't be written, so they and their subfolders are left out.
- The JSON `about` block is `{exportedAt (UTC ISO), exportedAtLocal (ISO with milliseconds and offset), collection, count, view, filters, version}`. It leaves out `columns`, because JSON keeps every field.
- In `about`, only `exportedAt` and `collection` are required. `count` defaults to the row count, `columns` to the export columns, `view` and `version` to empty, and `filters` to none.
- The About sheet also has a "Cells" row. It adds a "Clickable links" row only past Excel's 65,530 hyperlinks per sheet. An address longer than 2,079 characters stays exact text without a link.
- A typed file name stays in the field for later downloads until it is cleared or the collection changes. Changing the format moves a typed matching extension to the new one.
- "Skip links already in that folder" also applies to a new folder, where it skips repeats within one save. The Bookmark button then counts distinct web links.
- `core/export.js` also exports `FORMAT_EXTENSIONS`, the file extension for each format.

**Backup and restore**

- Replace takes its confirmation from the restore preview, with Undo afterwards; there is no second "are you sure".
- Backup files are compact one-line JSON, so about 80,000 links fit under the 50 MB restore limit. A larger backup still downloads, with a warning that it can't be restored in one step.
- The backup file name keeps its date and time even when export names leave them out.

### Storage keys

| Area | Key | Contents |
| --- | --- | --- |
| local | `linkMeteorState` | State (unchanged). |
| local | `linkMeteorRestoreUndo` | The restore Undo snapshot above. |
| session | `linkMeteorTarget`, `linkMeteorCaptureReport`, `linkMeteorCaptureReportDismissed`, `linkMeteorActivationError` | Unchanged. |
| session | `linkMeteorOpenIntent` | `{view, batchId, createdAt}` from `ui.open`, or from Review on the capture card. |

### Permissions

| Permission | Change | When it is asked for |
| --- | --- | --- |
| Optional `http://*/*` and `https://*/*` | Already declared; newly requested as one choice | From the welcome card or the settings switch, never at install. |
| Optional `tabGroups` | New | When the person first chooses to open links as a named tab group. |
| `unlimitedStorage` | New, required | No prompt. |

Every permission also needs a reason in the UI, in [PRIVACY.md](PRIVACY.md) and in `CHROMEWEBSTORE.md` before it ships. Extension pages keep `connect-src 'none'`.

### Stable element IDs for 0.3.0 suites

Suites may rely on these IDs; renaming one is a contract change.

- **Welcome card** (`#welcome`, top of the main column): `#welcome-ask`, `#welcome-title`, `#welcome-key`, `#welcome-allow`, `#welcome-later`, `#welcome-close`, `#welcome-outcome`, `#welcome-outcome-text`, `#welcome-done`.
- **Site access** (the rail's site section):
  - all sites: `#all-sites`, `#all-sites-help`, `#all-sites-note`, `#all-sites-remove`, `#all-sites-remove-text`, `#all-sites-remove-yes`, `#all-sites-remove-no`;
  - this site: `#site-hold-row`, `#site-exception-row`, `#site-exception`, `#site-exception-help`;
  - hold key: `#hold-trigger`, `#hold-trigger-help`, `#hold-letter-row`;
  - exceptions: `#exceptions-title`, `#exception-count`, `#hold-exceptions` (list items `.exception-item`), `#hold-exceptions-empty`.
- **Capture:** `#scope-access-help`. A denied result offering all sites has a `.report-allow` button.
- **Opening links:**
  - `#open-confirm`, `#open-confirm-yes` (both existing), `#open-confirm-window`, `#open-confirm-group`; `.open-confirm-strong` marks the stronger wording above 100;
  - `#open-window`, `#open-group`, `#open-group-help`;
  - `#open-progress`, `#open-progress-text`, `#open-progress-bar`, `#open-cancel-progress`.
- **Export names:** `#export-name`, `#export-name-help`, `#name-settings`, `#name-prefix`, `#name-prefix-help`, `#name-timestamp`, `#name-timestamp-format`, `#name-pattern`.
- **Bookmarks:**
  - `#bookmark-mode`, a radio group: `#bookmark-mode input[value=new|existing]`, with `#bookmark-new` and `#bookmark-existing`;
  - `#bookmark-folder-search`, `#bookmark-folder`, `#bookmark-folder-status`, `#bookmark-skip-existing`, `#bookmark-help`.
- **Backup** (`#backup-panel`, in the rail before About and help): `#backup-title`, `#backup-help`, `#storage-help`, `#backup-download`, `#backup-file`.
- **Restore:**
  - preview: `#restore-preview`, `#restore-title`, `#restore-source`, `#restore-modes`, `#restore-merge`, `#restore-replace`, `#restore-cancel`;
  - after a restore: `#restore-status`, `#restore-status-text`, `#restore-status-help`, `#restore-undo`, `#restore-discard`.
- **Review:**
  - existing: `#select-all`, `#select-everything`;
  - new: `#select-all-label`, `#remove-view`, `#empty-undo`;
  - Remove all in this view: `#remove-view-confirm`, `#remove-view-confirm-text`, `#remove-view-confirm-yes`, `#remove-view-confirm-no`;
  - Empty this collection: `#empty-collection`, `#empty-confirm`, `#empty-confirm-text`, `#empty-confirm-yes`, `#empty-confirm-no`.

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
| `open.js` | Opening links: confirmation tiers, new window, tab group, progress and Cancel. |
| `export.js` | Format, columns, the export target, downloads and copies. |
| `bookmarks.js` | Bookmark folders. |
| `settings.js` | Site access: all sites, this site, exceptions, the hold trigger and key, and the region shortcut. |
| `access.js` | Pure access and opening rules shared by the access modules: `ALL_SITES`, the 20/100/500 tiers, the hold gesture's name, page-access planning. |
| `welcome.js` | The first-run welcome card. |
| `names.js` | The File name field and the name pattern settings. |
| `backup.js` | Backing up, the restore preview, restore and its Undo. |
| `about.js` | Version and help. |

The service worker entry `background.js` owns capture, routing and Chrome events. The rest lives in `background/`:

- `store.js`: the serialized state queue, `readState`, `mutate`, `writeState(previous, next, extra)` and `onStateWritten(listener)`.
- `urls.js`: URL rules.
- `hold.js`: hold-key registration, the access upkeep that follows saved writes and permission changes, and its `hold.*` messages.
- `open.js`: opening links in batches, with progress and Cancel.
- `card.js`: the capture card's messages and the open intent.
- `bookmarks.js`, `backup.js` and `hold.js` each export `workbenchMessages`, a table of workbench-only message handlers. The entry routes them and refuses a type claimed twice.

The release contains the fixed files named in `scripts/release-files.mjs`, plus any `.js` or `.css` modules in `ui/workbench/` and `background/`. Any other file in `src/` stops the build.
