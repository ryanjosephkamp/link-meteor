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

These contracts were written before 0.3.0 was built and are implemented in 0.3.0. [ACCEPTANCE.md](ACCEPTANCE.md) records what a release contains and how it was tested. Where 0.3.0 changes an existing message, the description above stays accurate for 0.2.2 and this section describes 0.3.0.

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

## Added in 0.4.0

These contracts were written before the 0.4.0 features were built. [ACCEPTANCE.md](ACCEPTANCE.md) records what a release contains and how it was tested.

### Settings: more additive schema-v1 fields

| Field | Type and default | Meaning |
| --- | --- | --- |
| `theme` | one of `THEME_IDS`, `'meteor'` | The look of the workbench, the on-page card and the toolbar icon. |
| `appearance` | `'system'`, `'light'` or `'dark'`, `'system'` | Light or dark for the workbench and the on-page card. System follows the computer. |
| `afterDrag` | `'card'`, `'copy'` or `'add'`, `'card'` | What releasing a region selection does: show the card, copy right away, or add right away with Undo. |
| `afterDragFormat` | `'tsv'`, `'text'`, `'markdown'` or `'rich'`, `'tsv'` | The copy format for `afterDrag: 'copy'`. |
| `contentOnly` | boolean, `false` | Leave out links in page navigation, headers, footers and sidebars. |
| `skipSaved` | boolean, `false` | When adding, skip links whose URL the destination collection already holds. |

`migrateState` fills absent fields as before. **Backup format 2:** `BACKUP_FORMAT_VERSION` is 2, so 0.3.0 refuses a 0.4.0 backup with an update message instead of dropping these settings. `readBackup` still reads format 1 files; missing settings take their defaults.

### Themes (`src/core/themes.js`, pure data)

- `THEME_IDS`: `meteor`, `comet`, `aurora`, `ember`, `nebula`, `graphite`, `contrast` (High contrast).
- `THEMES[id]` has `name`, `blurb` and `swatch`, plus:
  - `light` and `dark`: every workbench token in `WORKBENCH_TOKENS` (the custom properties of `ui/workbench.css`);
  - `card.light` and `card.dark`: every role in `CARD_ROLES` (`ground`, `ground2`, `strong`, `ink`, `soft`, `muted`, `faint`, `warn`, `accent`, `accent-hover`, `on-accent`, `link`, `link-hover`, `focus`);
  - `highlight` and `edge`: the selection box and matched links, the same in both schemes.
- **Meteor** is the 0.3.0 look, value for value (`tests/themes.test.mjs` checks it against the stylesheet and the page script).
- `themeCss(id, scheme)` returns `:root{color-scheme:…;--token:…}` with every token, so it fully replaces the stylesheet's own values in either scheme.
- `cardVars(id, scheme)` returns the card's custom properties (`--k-<role>`, `--k-hl`, `--k-edge`, `--k-shadow-45`, `--k-shadow-25`, `color-scheme`).
- `cardTheme(id, appearance)` returns `{theme, appearance, light, dark}`.
- An unknown id falls back to Meteor.

### The page script's colors and settings

- **Colors.** The card's style names every color by role: `:host` defaults are Meteor's dark card, and the theme's `cardVars` override them on the host element. The selection box and matched links use `--k-hl` and `--k-edge`, with the same dark navy ring on every page.
- **Scheme.** The card picks `light` or `dark` from `appearance`, or for System from `prefers-color-scheme`, and follows a change while it is open.
- **What carries the theme.** `settings.get` adds `card` (`cardTheme(settings.theme, settings.appearance)`). `content.configure` adds `card` and `capture` (`{afterDrag, afterDragFormat, contentOnly, skipSaved}`).
- **When it's sent.** A saved change to `theme`, `appearance` or a capture setting reconfigures open tabs, as hold settings do. Script registration changes only with the hold fields.

### Clipboard: rich links

`core/export.js` exports `richLinks(rows)`, which returns `{html, text}`:
- `html` is a `<ul>` of `<a href>` items with escaped anchor text; an empty anchor shows its URL;
- `text` has one link per line, as `anchor text (URL)`, or just the URL;
- only HTTP(S), `mailto:` and `tel:` URLs are accepted.

Callers write a `ClipboardItem` with `text/html` and `text/plain`, and fall back to plain text.

### Messages

- **`capture.saved`** `{collectionId?, urls}` returns `{saved: string[]}`: which of those URLs the collection (default: the active one) already holds. It returns nothing else about the collection.
- **`capture.commit`** accepts `skipSaved?: boolean`. It returns `{count, skipped, …}`: skipped links are left out, and `count` is what was added.
- **`capture.copy`** accepts `format: 'rich'` and returns `{text, html}`.
- **`capture.undoAdd`** `{collectionId, batchId}` removes the occurrences that one add created. It is refused if the collection no longer holds exactly that batch.
- **`capture.preference`** `{contentOnly?, skipSaved?}` returns `{contentOnly, skipSaved}`. Page. It saves only those two settings, each a boolean, at least one; any other field is refused.
- **`capture.includeLeftOut`** `{batchId}` returns `{state, count, skipped, total, collectionId, name}`. Workbench. It adds the navigation links that *Capture this page* left out (below) to the collection that capture went to.
- **`diagnostics.get`** (workbench only) returns a JSON-safe object:
  - version, the user agent and brands, platform and language;
  - settings, with `holdOrigins` and `holdExceptions` reported as counts;
  - permission booleans for `tabs`, `bookmarks`, `tabGroups`, `downloads` (0.4.0) and all sites, plus the count of per-site origins;
  - script registrations (count and scope);
  - storage bytes in use, collection count, total link count, and the time.

  It never includes URLs, origins, page titles, notes, tags or collection names.

### Workbench extras, as built

**`diagnostics.get`** is answered by `background/diagnostics.js`, which exports `workbenchMessages` like `bookmarks.js`, `backup.js` and `hold.js`. It returns:

```js
{createdAt,                      // ISO time
 version,                        // the manifest's
 browser: {userAgent, brands: [{brand, version}], mobile, platform, os, arch, language, uiLanguage},
 settings: {holdKey, holdOrigins, holdTrigger, holdScope, holdExceptions, welcomeSeen, exportPrefix,
   exportTimestamp, exportTimestampFormat, theme, appearance, afterDrag, afterDragFormat,
   contentOnly, skipSaved, otherFields} | null,
 permissions: {tabs, bookmarks, tabGroups, downloads, allSites, siteOriginCount},
 scripts: {count, scope: 'none'|'sites'|'all'|'other'|'mixed'|'unknown', matchCount, excludeCount, matchesSettings},
 storage: {bytesInUse, stateBytes, restoreUndoBytes},
 data: {readable, collections, links, undoLinks}}
```

- Every value is a number, a boolean, `null`, a fixed choice or a fact about the browser. `holdOrigins` and `holdExceptions` are counts, and `exportPrefix` is its length, because they hold the person's own text. A saved value outside its fixed choices reads `'invalid'`, never the value; a field that isn't saved reads `'missing'`. `otherFields` counts settings a later version saved, without their names.
- `SETTING_REPORTS` in `background/diagnostics.js` says how each setting is reported. A new setting needs an entry there; `tests/diagnostics.test.mjs` fails otherwise.
- `siteOriginCount` counts granted origins other than the two all-sites patterns. `scripts` counts every registration and its match and exclude patterns, never the patterns themselves. `matchesSettings` says whether the registrations are what the saved settings and Chrome's grants call for.
- When the saved state can't be read, `settings` is `null`, `data.readable` is false and its counts are `null`. A Chrome call that fails leaves `null` (or `false` for a permission) instead of failing the request.

**Copy as rich links** (`#copy-rich`, the fourth button in the Export panel's copy grid) uses `targetRows()`, like the other copies, and `richLinks()`. It writes a `ClipboardItem` with `text/html` and `text/plain`. The status reads "Copied 24 links as rich links. Paste into Google Docs, Word or Notion to keep them clickable." If Chrome refuses the item, it writes the plain text alone and says the links won't paste as clickable links.

**Copy diagnostics** (`#copy-diagnostics`, described by `#diagnostics-help`, in About and help) copies `diagnostics.get` as JSON indented by two spaces, with a final newline.

**Website links carry the theme.** About and help's links to the Link Meteor website (the guide and the home page) are marked `data-site-link`. On every render they add `?theme=<id>` from `settings.theme`, except for Meteor or an unknown theme. The other links never change.

### Behaviors

- **After a drag:**
  - `card` is the 0.3.0 card;
  - `copy` copies the selection at once in `afterDragFormat` and shows a small notice with *Show links*, which opens the card;
  - `add` commits at once to the destination and shows a notice with *Undo* (`capture.undoAdd`) and *Show links*.

  Escape closes the notice.
- **Content links only:**
  - A link is page chrome when it sits inside `nav` or `aside`, inside `[role=navigation]`, `[role=banner]`, `[role=contentinfo]` or `[role=complementary]`, or inside a page-level `header` or `footer` (one that is not inside an `article`, `main` or `section`, as HTML maps them to banner and contentinfo). A post's own header and footer are content.
  - With `contentOnly`, the card starts with those links unticked and says how many, with *Include them*. *Capture this page* leaves them out and reports how many.
  - Captured occurrences are otherwise unchanged.
- **Card filters:** chips (All, Other sites, PDFs, Same site) untick the preview's links that don't match. They are not saved.
- **Already saved:** the card asks `capture.saved` for its destination and marks matching rows *Saved*. A *Skip saved* checkbox follows `skipSaved`.
- **Workbench:**
  - `<html>` gets `data-theme` and `data-scheme`, and a style element holds `themeCss`;
  - the last theme and scheme are cached in `localStorage` for the first paint: the key `linkMeteorTheme` holds `{theme, scheme, appearance}`, and the module script is render-blocking (`blocking="render"`), so the first frame already has them. For System, the scheme is read from `prefers-color-scheme` at startup and followed while the page is open;
  - Settings gains Appearance (theme and System, Light or Dark) and After a drag (with the two capture defaults);
  - the Export panel gains *Copy as rich links*;
  - About and help gains *Copy diagnostics*.
- **Toolbar icon:** drawn with `OffscreenCanvas` from the mark in the theme's `highlight` color, and set with `chrome.action.setIcon` at startup and when the theme changes. The manifest's icons stay Meteor.
  - The image data is 16 and 32 px, with the geometry of `assets/brand/icon-16.svg` and `icon.svg`: the tile in the theme's light `mark-tile`, and the trail and head in `highlight`.
  - Meteor sets the manifest's `action.default_icon` paths, so it is the packaged icon exactly.
  - It is set on `runtime.onStartup`, on `runtime.onInstalled` (install and update), and after any saved write that changes `theme`, including a restore.
- **Website:** the same palettes as CSS, a theme menu in the header kept in `localStorage`, and `?theme=<id>`, which About and help's links add. There is no `externally_connectable`: the site never detects the extension.
  - `site/assets/css/site.css` has a `:root[data-theme="<id>"]` block per theme and scheme, derived from `THEMES`; `tests/themes.test.mjs` checks them. Meteor is the site's own `:root`.
  - The header's inline script sets `data-theme` before first paint: a known `?theme=<id>` wins and is kept (key `linkMeteorSiteTheme`), then the kept choice, then Meteor. An unknown id is ignored.
  - The menu is a menu button with `menuitemradio` items. Choosing a theme keeps it and removes `?theme=` from the address.

### The capture card and Capture this page, as built

**Messages**

- `capture.saved` takes any sender (a page or the workbench). `urls` is an array of at most 20,000 strings, compared exactly with saved `url` values; the answer is unique and in the order asked. A chosen collection that no longer exists is an error.
- `capture.commit` returns `{state, count, skipped, batchId, collectionId, warning}`. `batchId` is the new occurrences' batch, or `''` when nothing was added; `collectionId` is the destination. An absent `skipSaved` skips nothing, as in 0.3.0. Repeats of one URL within the same add are not "already saved".
- `capture.copy` with `format: 'rich'` returns `richLinks()` of the ticked links. Any other format is refused.
- `capture.undoAdd` is a page message, accepted only from the tab that made the add, and returns `{count}`. "Exactly that batch" means every occurrence the add created is still in that collection, with no notes or tags added. The workbench's removal Undo is kept. Each add is undone at most once.
- `capture.run`: each result gains `leftOut` (navigation links left out) and `skipped` (links already saved), both numbers. The page script's `scan()` marks each candidate in page chrome with `pageChrome: true`; with `contentOnly`, those are left out. `skipSaved` applies to *Capture this page* too.
- `capture.includeLeftOut` refuses a batch that isn't the one kept, and says so. With `skipSaved`, links already saved are skipped. Afterwards the kept links are removed, and the kept report gains `leftOutIncluded` (the number added), so a view that shows it later doesn't offer Include them again. A destination that no longer exists adds nothing and keeps the links.

**Storage keys (session)**

| Key | Contents |
| --- | --- |
| `linkMeteorLeftOut` | `{batchId, collectionId, total, links: Link[], createdAt}`: the latest *Capture this page*'s left-out links, at most 5,000 of `total`. The next capture replaces it, or removes it when nothing was left out. |
| `linkMeteorRecentAdds` | `[{tabId, collectionId, batchId, count}]`: the 20 most recent adds from pages, for `capture.undoAdd`. |

**The card**

- **Page chrome** is checked through open shadow roots (a link counts when any shadow host around it is in page chrome) and same-origin frames (a frame inside page chrome makes all its links page chrome). The rule counts every `header` and `footer`, including those inside an `article`.
- **After a drag** uses the links the card would start with ticked, so with `contentOnly` the navigation links are left out of the copy or the add. When none would be ticked, the card opens instead.
- **The notice** (`.notice`) is a panel in the card's shadow root, in the card's colors, at the card's corner. Its text (`.notice-text`, a status region) reads "Copied 12 links as a table" (`as URLs`, `as Markdown`, `as rich links`, or `as plain text` when rich copy fell back), plus "Left out 9 navigation links." when any were; or "Added 12 links to “Thesis sources”." (with "; 4 were already saved" when some were skipped). Buttons: `.notice-undo` (after an add), `.notice-show` (*Show links*) and `.notice-close`. It closes itself 8 seconds after it last appeared, lost focus or lost the pointer, and never while it has focus or the pointer is over it. A new drag replaces it. Undo there says "Removed 12 links from “Thesis sources”." and lets the card add again; *Show links* after an add shows the receipt with an Undo button.
- **Filters** (`.chips`, buttons with `aria-pressed` and a check mark when chosen) are one choice at a time. Choosing one ticks again what the previous filter unticked, then unticks what doesn't match; choosing it again, or *All*, returns to All. Ticks changed by hand stay as they are. A site is the host name without a leading `www.`; *Same site* and *Other sites* count only HTTP(S) links against the page's host; *PDFs* are links whose path ends in `.pdf`, in any case. Filters apply to every selected link, including those past the preview's first 1,000.
- **Left out** (`.leftout`): "Left out 9 navigation links." with `.leftout-include` (*Include them*), then "Included 9 navigation links." with `.leftout-remember` (*Always include them*, shown while `contentOnly` is on), which sends `capture.preference {contentOnly: false}`.
- **Already saved:** matching rows get a `.tag` reading "Saved". The *Skip saved* row (`.skip`, checkbox `.skip-saved`) shows only while some ticked links are already saved, and says how many. When the checkbox differs from the setting, `.skip-remember` (*Make this the default*) sends `capture.preference {skipSaved}`. With links skipped, the receipt reads "Added 8 links to “X”; 4 were already saved."; otherwise the card's receipt still reads "Saved 12 links to “X”."
- **Copy as rich links** (`.m-rich`, shortcut L) writes a `ClipboardItem`. Where the async clipboard is unavailable, as on plain-HTTP pages, a copy event carries both types, and only then plain text.

**The workbench's capture report**

- The report ends with a line (`.report-left-out`): "Left out 9 navigation links." with *Include them*, then "Included 9 navigation links."; and "Skipped 4 links already saved." when any were. With several pages, each page's result also says how many.

## Added in 0.4.0 release candidate 2

Five additions from the owner's review of release candidate 1. As before, [ACCEPTANCE.md](ACCEPTANCE.md) records what was tested.

### Custom columns (data)

- A collection may have `fields: [{id, name}]`, up to `MAX_CUSTOM_FIELDS` (20):
  - `id` is `f-…`, generated by `fields.add`;
  - `name` is trimmed, spaces collapsed, at most 60 characters, and unique in the collection, ignoring case.
- A link may have `fields: {fieldId: text}`: only column ids as keys; plain text up to `MAX_FIELD_VALUE` (2,000 characters); empty values dropped. A link with no values has no `fields` key.
- Both are optional: absent means none. A 0.3.0 state needs no migration, and 0.3.0 keeps both when it writes. Values for a column that no longer exists are ignored, never an error.
- **Reducer actions:**
  - `fields.add {collectionId?, name}`;
  - `fields.rename {collectionId?, fieldId, name}`;
  - `fields.remove {collectionId?, fieldId}` removes the column and every value in it. The workbench keeps what it removed for Undo.
  - `fields.restore {collectionId?, field, index, values: {linkId: text}}` puts a removed column back in its place, with its values.
  - `fields.fill {collectionId?, fieldId, ids, value}` sets one value on many links; `''` clears it.
  - `link.update` accepts `patch.fields: {fieldId: text}`, merged into the link's values; `''` clears one. Only the collection's own columns are accepted.
- **Search, exports and backups:**
  - `queryLinks` searches custom values.
  - `makeExport(rows, {…, fields})` exports custom columns as keys `field:<id>`, headed by their names, with spreadsheet formula protection as for every column.
  - Backup format 2 keeps columns and values. Merge joins a backup's columns to local ones by name, ignoring case; the rest are added while there is room, and each link's values follow. The summary counts `fieldsAdded` and `fieldsDropped`. Replace takes the backup's columns as they are.

### Custom columns in the workbench, as built

- **The collection editor** (`#fields-editor`, after the details form in `#collection-editor`) lists the columns in order. Each `.field-item` shows the name, how many links hold a value, *Rename* and *Remove*. `#fields-count` reads "3 of 20".
  - Adding: `#field-add`, with `#field-new` (at most 60 characters) and `#field-add-button`. `#field-add-help` says why a name can't be used (empty, already used ignoring case, or 60 characters reached). At 20 columns the field is disabled and says why.
  - Rename turns the row into a small form (`input[data-field-action="name"]`, help `#field-rename-help`). Enter saves; Escape cancels.
  - Remove asks first (`#field-remove-confirm`, `#field-remove-confirm-text`, `#field-remove-confirm-yes`, `#field-remove-confirm-no`) and says how many links hold a value. Afterwards `#fields-status` (`#fields-status-text`, `#field-undo`) and the notice offer Undo, which sends `fields.restore` with the column, its place and its values. The page keeps only the last removal, and only while it is open.
- **Link details:** after Note and Tags, one text field per column, labeled with its name (`input[data-link-field="field:<id>"]`). Save sends them with the note and tags in one `link.update`, whose `patch.fields` carries every column. A value over 2,000 characters is explained under the fields (`.field-limit`) and not saved. A single link's row shows its filled values after its note (`.field-value`).
- **Fill for selected links** (`#fill-fields`, in the list toolbar) shows while the view has selected links and the collection has a column. It opens `#fill-panel`: `#fill-field`, `#fill-value`, `#fill-help` (how many values it replaces), `#fill-apply` and `#fill-cancel`.
  - It sends one `fields.fill` for the selected links in the view, as Remove uses them. An empty value clears the column.
  - The notice's Undo puts each link's earlier value back, with one `fields.fill` per distinct earlier value.
- **Export columns:**
  - *Add a column…* lists the built-in columns, then a "Custom columns" group with the collection's columns not yet chosen, ending with *New custom column…* (value `new-custom-column`, disabled at 20).
  - *New custom column…* opens `#new-column` (`#new-column-name`, `#new-column-add`, `#new-column-cancel`, `#new-column-help`). It adds the column with `fields.add` and appends it to the export.
  - Export columns are keys `field:<id>`. When the collection changes or a column is removed, columns that no longer exist are dropped. Downloads and Copy table pass the collection's `fields` to `makeExport`.
- **JSON exports:** each row keeps its `fields`. When the collection has columns, `about` gains `fields: [{id, name}]`; otherwise it is unchanged.
- **Restore preview:** a merge lists "Adds 2 custom columns to joined collections" and "1 custom column can't fit, because a collection holds at most 20; its values are left out" (`.restore-fields-dropped`). The merge notice adds "; added 2 custom columns" and "; 1 custom column didn't fit".
- **Code:** `ui/workbench/fields.js` holds the editor's column list, the details fields, Fill for selected links and the shared name and length rules. `collections.js`, `review.js` and `export.js` call it.

### Save tabs as links

- The workbench's capture area gets a choice of what to capture:
  - *Links in the pages* (default, as before);
  - *The tabs themselves*, which makes one link per tab for the current scope (This page, Pick tabs, This window, All windows).
- **Each saved tab:**
  - `anchorText` is the tab's title, with whitespace collapsed; it is the browser's own title and nothing is fetched;
  - `url`, `originalHref` and `sourceUrl` are the tab's address, and `sourceTitle` its title;
  - `frameUrl` and `accessibleLabel` are empty;
  - one `batchId` for the save.
- Tabs that aren't HTTP(S) pages are skipped and counted, and so is a repeated address within one save. `skipSaved` applies.
- **Message:** `capture.tabs {scope, tabIds?, collectionId?}` returns a report like `capture.run`'s, with `saved`, `skipped` and `unsupported` counts. The tabs permission is needed only where capture already needs it (picking tabs, a window, all windows).

**As built** (`background/tabs.js`, and the capture area in `ui/workbench/capture.js`):

- `capture.tabs` is a workbench message and returns `{state, report}`.
  - `scope` is `'current'`, `'selected'`, `'window'` or `'all'`. `tabIds` (integers, at most 20,000, each taken once) are the tabs to save.
  - Without `tabIds`: `'current'` is the target tab, found as for `capture.run`; `'window'` is the focused normal window's tabs; `'all'` is every normal window's tabs; `'selected'` is refused.
  - A chosen collection that no longer exists is an error, and nothing is saved.
- The report is `{kind: 'tabs', batchId, results, capturedCount, saved, skipped, repeated, unsupported}`, kept at `linkMeteorCaptureReport` like a capture's. `capturedCount` equals `saved`. Each result has `capture.run`'s shape:
  - a saved tab is `success` with `count: 1`;
  - a tab skipped as a repeated address or as already saved is `success` with `count: 0`, `skipped: 1` and the reason in `warning`;
  - a tab that isn't an HTTP(S) page is `unsupported`, one whose address Chrome hides is `denied`, and a closed tab is `error`.

  `skipped` counts repeated and already saved tabs; `repeated` counts the repeated ones.
- **The workbench.** `#capture-what` is a radio group of `input[name=capture-what]` (`links`, the default, and `tabs`) under the scope. Like the scope, the choice lasts while the view is open.
  - With `tabs`, the capture button reads "Save this tab as a link", "Save 45 tabs as links" or "Save selected tabs as links". The count leaves out tabs known not to be web pages; the preview says how many.
  - The report's title reads "Saved 45 tabs as links", followed by "2 skipped: not web pages" (and "already saved", "a repeated address", "hidden by Chrome", "closed before saving"). It lists only the tabs that weren't saved, each with its reason, and offers *Show only these links*.
  - Choosing Pick tabs or a window scope asks for tab access, as before. A save that still lacks it asks in the save click.
- **The open intent** (`linkMeteorOpenIntent`) may also hold `what: 'tabs'` and `scope`. The view then chooses The tabs themselves and that scope, says why tab access is needed (with a notice whose button saves), and focuses the capture button. The menus write it (below).

### Menus

Chrome shows several items from one extension under a "Link Meteor" submenu, so titles don't repeat the name.

| Right-click on (`contexts`) | Items |
| --- | --- |
| A link (`link`) | *Add link to “name”* (the active collection's name, updated when it changes) · *Copy link text + URL* · *Download linked file* (`targetUrlPatterns`: the file types below) · *Select a region* |
| Selected text (`selection`) | *Capture links in the selection* · *Select a region* |
| The page (`page`) | *Select a region* · *Capture this page* · *Save this tab as a link* |
| The toolbar icon (`action`) | *Save this tab as a link* · *Save all tabs in this window as links* · *Open the full view* |

- **The link's own text.** Chrome gives a menu click the link's address, not its text. The page script records the link under the last right-click (a `contextmenu` listener). After a menu click, which grants temporary access to the tab, the background loads the page script if needed and asks `content.contextLink {url}`. The answer is that link's captured fields, or the first link in the page with that address. The saved anchor text stays exact.
- **The selection.** `content.selectionLinks` returns the captured fields of every link that intersects the page's selection, across open shadow roots and same-origin frames as capture does.
- **Feedback.** Saving from a menu uses the page's notice: "Added 1 link to “Thesis sources”", with *Undo* (`capture.undoAdd`) and *Show links*. *Copy link text + URL* copies two tab-separated columns with a header, like the card.

**As built** (`background/menus.js`, and the page script's menu section):

- **Items.** The IDs are `meteor-add-link`, `meteor-copy-link`, `meteor-selection`, `meteor-region` and `meteor-page` (both kept from 0.3.0), `meteor-save-tab` (contexts `page` and `action`), `meteor-save-window` and `meteor-full-view`.
  - `createMenus({extra})` creates them in the table's order on install and update. An `extra` item `{after, ...item}` goes after the item `after` names, so *Download linked file* can follow `meteor-copy-link`.
  - `menuClicked` answers only these IDs and leaves other items' clicks to their own modules.
- **The title** "Add link to “name”" is updated after every saved write that changes which collection is active or its name, and at startup. A "%s" in a name gets a zero-width space, because Chrome puts the selected text in place of %s.
- **Page messages.** The background sends them to the tab's top frame and loads the page script first when none answers. The page answers `{ok: true, data}` or `{ok: false, error}`.
  - `content.contextLink {url}` answers `{link}`: the captured fields of the link under the last right-click when its URL equals `url`; otherwise those of the first link in the page with that URL, found as capture finds links; otherwise `null`.
  - `content.selectionLinks` answers `{links, warnings}`. A link is selected when it intersects the selection of the innermost tree (a shadow root or a document) that holds selected ranges. So a selected shadow host counts the links inside it, and a same-origin frame's own selection counts.
  - `content.notice {text, added?, copy?}` answers `{}` and shows the notice alone, with no selection layer and no card; the page keeps taking clicks.
    - `added` is `{collectionId, batchId, name}`. It adds *Undo* (`capture.undoAdd`) and *Show links*, which sends `ui.open {view: 'links', batchId}`. Without it, the notice has only its close button.
    - `copy` is text the page writes to the clipboard first, as the card copies, including the hidden text-area fallback.
- **What each item does.** Saves go to the active collection, whatever the card last chose, and `skipSaved` applies. A save that adds links is remembered for `capture.undoAdd` with the tab that shows its notice (`rememberAdd` in `background/card.js`).
  - *Add link*: a link the page can't find (inside another site's frame, say) is saved with its URL, an empty anchor text and original href, and the frame's URL. The notice says it was saved with its address only. Links other than HTTP(S), `mailto:` and `tel:` are refused. When nothing is added, the notice reads "Nothing was added: 1 link was already in “X”."
  - *Copy link text + URL*: `makeExport([link], {format: 'tsv', columns: ['anchorText', 'url']})`, as the card copies. Nothing is saved.
  - *Capture links in the selection*: one add in one batch. An empty selection saves nothing and says so.
  - *Save this tab as a link* and *Save all tabs in this window as links* save through `capture.tabs`'s rules. The notice reads "Saved this tab as a link in “X”." or "Saved 12 tabs as links in “X”; 2 skipped: not web pages."
  - *Save all tabs in this window* without the tabs permission saves nothing. It keeps the open intent `{view: 'links', batchId: '', what: 'tabs', scope: 'window'}` and opens the full view in that window.
  - Where the page can't show the notice (a browser page, say): after a save, the full view opens at that batch. Otherwise the reason is shown there, as an activation error.
  - *Select a region* and *Capture this page* do what they did in 0.3.0. *Open the full view* opens it in a new tab.

### Downloads

- **The permission.** The optional `downloads` permission is requested from the workbench, with a user gesture, the first time someone downloads. The reason sits next to the control. The card and the menus can't show Chrome's prompt; without the permission, they explain and open the full view at its downloads section.
- **Which links are files:**
  - the URL's path ends in a file extension (PDF, office and OpenDocument files, text and data files, e-books, archives, images, audio, video);
  - or the anchor text starts with `[PDF]`;
  - or the URL matches a known PDF address (arXiv `/pdf/`, OpenReview `/pdf?id=`).

  A link's details offer *Download* for any link.
- **Saving:**
  - `chrome.downloads.download` into `Downloads/Link Meteor/<collection name>/`;
  - each file is named after its anchor text (`fileNamePart`), with the extension from the URL or, failing that, from the type Chrome reports;
  - `conflictAction: 'uniquify'`, never a Save As dialog.
  - Up to 100 files per action, confirmed above 10, at most 3 at a time, with progress and Cancel.
- **Honest results.** Each download is followed to completion:
  - a finished file whose type is HTML is reported as "gave a web page instead of a file";
  - an interrupted one reports Chrome's reason.

  Link Meteor never searches, opens, changes or removes other downloads.
- **Messages:** `downloads.start {links, collectionName, requestId}` (workbench), `capture.download` (page), `downloads.cancel {requestId}`, and `downloads.progress` notifications to the sender.

#### Downloads, as built

**Which links are files** (`src/core/files.js`, pure; the page script keeps a copy of `fileLink` that `tests/files.test.mjs` checks against it):
- `FILE_TYPES`, by kind: documents (`pdf ps eps`), office (`doc docx docm dot dotx xls xlsx xlsm xlt xltx ppt pptx pptm pps ppsx pot potx rtf`), OpenDocument (`odt ods odp odg odf ott ots otp`), text and data (`txt md markdown csv tsv json jsonl xml yaml yml bib ris enw nbib tex ipynb`), e-books (`epub mobi azw azw3 djvu fb2`), archives (`zip gz tgz tar bz2 xz 7z rar zst`), images (`png jpg jpeg gif webp svg tif tiff bmp avif heic heif ico`), audio (`mp3 wav m4a aac ogg oga flac opus`), video (`mp4 m4v mov webm mkv avi ogv`). Web pages and programs are never file types. The extension is the last path segment's, in any case; the query and fragment don't count.
- Anchor text that starts with `[PDF]`, in any case.
- Known PDF addresses: arXiv `/pdf/…` (any `arxiv.org` host), OpenReview `/pdf?id=…`, the ACM Digital Library `dl.acm.org/doi/pdf/…`, and PubMed Central `…/pmc/articles/PMC…/pdf` and `pmc.ncbi.nlm.nih.gov/articles/PMC…/pdf`.
- `isFileLink(link)`, `fileLinks(links)` (one per address, in order), `urlFileType`, `knownPdf`.

**Names and folders:**
- The folder is `Link Meteor/<fileNamePart(collection name, 80)>`, or `Link Meteor/links` without a name.
- The file is `fileNamePart(anchor text, 100)`, without a leading `[PDF]`, `[HTML]`, `[DOC]`, `[DOCX]`, `[PS]`, `[BOOK]` or `[CITATION]` label; else the accessible label; else the address's own file name; else `file`. An anchor that already ends in the extension isn't doubled. Windows device names get `_` (`CON_.pdf`).
- The extension (`downloadExtension`): **a web page is saved as `.html`**, so a sign-in page never becomes a fake PDF; otherwise the address's file type, then the type Chrome reports, then the extension of the name Chrome suggests, then `pdf` for a known PDF address.
- Chrome names the file through `onDeterminingFilename`, once it knows the type, with `conflictAction: 'uniquify'` (Chrome adds " (1)"). `download()` also gets `saveAs: false` and a fallback name from the address alone.

**The background** (`src/background/downloads.js`):
- `downloads.start {links:[{url, anchorText?, accessibleLabel?}], collectionName?, requestId?, confirmed?}`. Workbench. Web (HTTP(S)) links only, one per address; 1 to 100; more than 10 need `confirmed: true`. Any link may be downloaded; a file link that brings back a web page counts as a web page.
- `capture.download {links, collectionId?, requestId?, confirmed?}`. Page. Only the file links among the links are downloaded, into the folder of the destination collection (default: the active one). With no file links it is refused.
- The result of both: `{requestId, folder, total, done, saved, webPages, failed, cancelled, held, results, summary}`. Each result is `{url, anchorText, file, mime, status}`, with `status` one of `saved`, `web-page`, `failed` (with `error`, Chrome's interruption code, and `reason`, in plain words with the code), `cancelled` or `held` (Chrome holds a file it considers dangerous for the person to review; Link Meteor doesn't wait for it). `file` is the base name only, and empty when nothing was saved. `summary` is one sentence, for example "Saved 4 files to Link Meteor › Thesis-sources in your downloads folder. 1 link gave a web page instead of a file, often a sign-in page. 1 download failed."
- `downloads.progress {requestId, total, done, saved, webPages, failed, cancelled, held}`: once at the start and after each file, to the workbench (`runtime.sendMessage`) or to the card's tab. The menu's download ends with one more to its tab, with `final: true` and `text` (the summary).
- `downloads.cancel {requestId}` => `{cancelled}`. Workbench, or the page that started the request. Nothing more starts, and downloads in progress are canceled; Chrome removes their partial files. Files already saved stay.
- At most 3 downloads run at a time across every request, first come first served. Each is followed with `onChanged` and looked up by its own id once a second (which also keeps the service worker awake) until it completes, is interrupted, is held, or disappears from Chrome's list (`failed`, "it was removed from Chrome’s downloads list").
- The `onDeterminingFilename` and `onChanged` listeners exist only while something downloads. Chrome asks every such listener about every download; Link Meteor answers `suggest()` with no name for any download it didn't start (checked by id, or by address and `byExtensionId` when Chrome asks before `download()` answers), so those keep Chrome's own names.
- Without access (`permissions.contains({permissions:['downloads']})` and `chrome.downloads`), `downloads.start` and `capture.download` are refused with an error that begins "Download access is needed". `capture.download` first keeps its file links at session key `linkMeteorPendingDownloads`: `{links, collectionName, source: 'card'|'menu', createdAt}`.

**The menu item:** `{id: 'meteor-download', title: 'Download linked file', contexts: ['link'], targetUrlPatterns: menuPatterns()}`, created on install. The patterns are `*://*/*.<ext>` and `*://*/*.<ext>?*` for every file type, in lowercase and uppercase, plus the known PDF addresses; `[PDF]` labels can't be matched by address. A click loads the page script (the click grants temporary access), asks `content.contextLink {url}` for the link's own fields and falls back to the address alone, then downloads into the active collection's folder and sends the tab the final `downloads.progress`. Without access, the link waits at `linkMeteorPendingDownloads` (`source: 'menu'`) and the full view opens (`ui.open`).

**The workbench** (`src/ui/workbench/downloads.js`):
- The Export panel's *Download files* section downloads the file links in the export target (`targetRows()`): "Download 6 files", with "…" above 10, disabled with no file links or more than 100. The help says where files go and how many other links aren't file links. While Chrome reports no access, `#downloads-access` gives the reason next to the button.
- The click that starts downloading calls `chrome.permissions.request({permissions: ['downloads']})` before anything is awaited: the button up to 10 files, the confirmation's button above 10, a link's *Download*, or the waiting files' button. A decline downloads nothing and says so.
- Above 10, an inline confirmation names the count and the folder; Escape closes it. Progress ("Downloading 12 files: 5 done…") with Cancel, then the result: the summary and a list of the links that brought a web page, failed or were held.
- Each link's details offer *Download* (`.occurrence-download`), for any link, into the collection's folder.
- Files waiting at `linkMeteorPendingDownloads` are shown once by the next full view that opens, if they are at most 10 minutes old: at compact widths it switches to the export view, and it focuses their button. The key is removed when read.

**The capture card:** *Download N files* (`.m-files`, shortcut F) in the More menu, after *Download this selection*, counts the file links among the ticked ones, one per address. Above 10 it asks first (`.fconfirm`: "Download 12 files into your downloads folder?", Download 12, Cancel; Escape closes it). While downloading, the status shows progress (`.fstatus-text`) and Cancel (`.fcancel`), then the summary. Without access it shows the error and *Open the full view* (`ui.open`), where the files wait. After the menu's download, the final `downloads.progress` text goes in an open card's status, or in a small notice (`#link-meteor-download-notice`, marked like the card, in the card's colors, `.notice-text` with `role="status"`, `.notice-close`), which closes itself 8 seconds after it last had the pointer or focus.

**Stable element IDs:** `#downloads-section`, `#downloads-title`, `#downloads-start`, `#downloads-label`, `#downloads-help`, `#downloads-access`, `#downloads-confirm`, `#downloads-confirm-text`, `#downloads-confirm-yes`, `#downloads-confirm-no`, `#downloads-progress`, `#downloads-progress-text`, `#downloads-progress-bar`, `#downloads-cancel`, `#downloads-result`, `#downloads-pending`, `#downloads-pending-text`, `#downloads-pending-start`, `#downloads-pending-dismiss`.

**Chrome's behavior, as observed in Chrome for Testing:**
- Without DevTools download settings, `chrome.downloads` saves into the profile's `download.default_directory` preference and, without it, into the system's Downloads folder (on macOS, in the home folder the browser process sees).
- DevTools `Browser.setDownloadBehavior` (Playwright's `acceptDownloads` uses it) takes over `chrome.downloads` too: files go to its folder, `onDeterminingFilename` never fires, and the `filename` option and folders are ignored.
- When any extension listens to `onDeterminingFilename`, a download's creator `filename` is used only if a listener suggests one; `suggest()` with no name gives Chrome's own name.
- A 404 ends as `interrupted` with `SERVER_BAD_CONTENT`. A canceled download leaves no partial file.

### Highlights after release

- **What's highlighted:** after a region selection is released, every selected link (up to 250), not only those under the last rectangle. Each box is redrawn from its link's current rectangles, including through same-origin frames, once per animation frame whenever the page or a scrolling box scrolls or the window resizes. So the highlights stay on their links.
- **Unticked links** show a dashed outline instead of a filled box.
- **The selection rectangle** disappears on release.

## Added in 0.5.0

These contracts are for 0.5.0 "Research tools". They were written before building, and each area's "as built" part records what was settled while building. As before, [ACCEPTANCE.md](ACCEPTANCE.md) records what was tested. Everything below stays in this browser, adds no server, and never looks anything up online: citations and identifiers come only from what the pages showed.

### Link and collection data

New optional fields; absent means none, so a 0.4.0 state needs no migration, and 0.4.0 keeps them when it writes.

| Field | Where | Type and limits | Meaning |
| --- | --- | --- | --- |
| `context` | link | string, at most `MAX_CONTEXT` (400) characters | The words around the link on its page, as captured (see [Context snippets](#context-snippets)). Never edited. |
| `status` | link | `'reading'` or `'read'` | Reading status. Absent means unread. |
| `starred` | link | `true` | Starred. Absent means not starred. |
| `imported` | link | string, at most 300 characters | Where an imported link came from, such as `labs-shortlist.csv, row 3` or `Bookmarks › Research › Labs`. Absent for captured links. |
| `pages` | collection | `{[pageUrl]: PageCitation}`, at most 5,000 entries | Citation details read from pages Link Meteor had open (see [Page citations](#page-citations)), keyed by the page's address without its `#fragment`. |

`PageCitation`: `{title, authors, date, journal, publisher, volume, issue, firstPage, lastPage, doi, pmid, arxiv, isbn, pdfUrl, readAt}`. `authors` is an array of at most 50 names, each as printed (at most 200 characters); every other field is a string (at most 300 characters; `date` at most 40, as printed); empty fields are left out.

- A link's **own citation** is `pages[link.url]` (without its fragment), present when Link Meteor read that page, for example when its tab was saved as a link.
- A link's **source citation** is `pages[link.sourceUrl]`: the page it was captured from.
- Entries no link refers to are tolerated and left out of backups and exports.

**Reducer actions:**
- `links.status {collectionId?, ids, status: '' | 'reading' | 'read'}`: `''` clears the status (unread).
- `links.star {collectionId?, ids, starred: boolean}`.
- `links.append` accepts `pages: {[pageUrl]: PageCitation}` beside `links`, merged into the collection's `pages`; a newer reading replaces an older one for the same address.
- The workbench keeps what `links.status` and `links.star` changed for Undo, as it does for `fields.fill`.

**`queryLinks`** gains `status: 'any' | 'unread' | 'reading' | 'read'`, `starred: boolean` and `typeGroup` (a file-type group as Insights shows it, from `typeGroup(link)` in `src/core/insights.js`), `site` (one site's links exactly, for Insights; the Domain option still matches part of a name), and its search also matches `context` and `imported`.

**Backup format 3.** `BACKUP_FORMAT_VERSION` becomes 3, so 0.4.0 refuses a 0.5.0 backup with its update message instead of dropping fields. `readBackup` accepts formats 1 to 3. A merge keeps local `status` and `starred` for links already present, and local page citations for addresses already present.

### Settings: additive schema-v1 fields

| Field | Type and default | Meaning |
| --- | --- | --- |
| `saveContext` | boolean, `true` | Save the words around each link when capturing. Off saves no `context`. |

### Context snippets

The page script sets `context` on each candidate:
- the link's nearest block ancestor: `p`, `li`, `dd`, `dt`, `td`, `th`, `blockquote`, `figcaption`, `caption`, `h1` to `h6` or `summary`; otherwise its parent;
- that block's `textContent`, spaces collapsed, cut at word boundaries to at most 400 characters around the anchor text, with `…` where cut;
- empty when the block holds only the link's own text, or when `saveContext` is off;
- empty when the words around the link are not prose: fewer than 8 letters of plain text (outside links) in the window read, or more letters in other links' text than in plain text, as in a bare list of links or a line of citations.

Regions and *Capture this page* set it. Saved tabs and imported links have none.

### Page citations

When capturing, the page script reads the top document's own citation tags, once per capture, and returns them as `page` beside `links` (`{links, inaccessibleFrames, warnings, page}`). It reads, in this order, the first that gives a title:
1. Highwire Press tags, the ones Google Scholar indexes: `citation_title`, `citation_author` (one per author), `citation_publication_date` or `citation_date`, `citation_journal_title`, `citation_publisher`, `citation_volume`, `citation_issue`, `citation_firstpage`, `citation_lastpage`, `citation_doi`, `citation_pmid`, `citation_arxiv_id`, `citation_isbn` and `citation_pdf_url`;
2. PRISM (`prism.publicationName`, `prism.volume`, `prism.number`, `prism.startingPage`, `prism.doi`);
3. schema.org JSON-LD whose `@type` is `ScholarlyArticle`, `Article`, `Book` or `Report` (a DOI only from `identifier` or `sameAs`);
4. Dublin Core (`DC.title`, `DC.creator`, `DC.date`, `DC.publisher`, `DC.identifier` when it is a DOI), in any case, as a last resort.

A page with none of these has no page citation. **Save tabs as links** also reads each tab's citation tags when Link Meteor already has access to that site (all sites, or that site); it never asks for access to do so, and the report says how many tabs it read.

### Context snippets and page citations, as built

Files: `content/capture.js`, `background/citations.js` (new), `background/card.js`, `background/menus.js`, `background/tabs.js` and the capture pipeline in `background.js`. Fixtures: `tests/fixtures/research/*.html`, served at `/research/<name>.html`.

**Context.**
- The block is the link's nearest ancestor in its own tree from the list above; otherwise its parent node (an element, or the open shadow root the link sits in).
- The text is the block's text nodes (textContent), read outward from the link on each side only as far as needed, at most 120 text nodes a side.
  - Text in `script`, `style`, `noscript`, `template` and SVG `title` or `desc` is skipped.
  - A space separates text in different block-level elements, and text on either side of a `br`, where textContent would join the words.
  - An open shadow root's text isn't part of its host's block.
- The middle is the link's anchor text as captured (innerText), so hidden text inside the link stays out and the anchor text can be found in the context.
- The room is 400 characters minus the anchor text's length, half on each side; a side that needs less gives the rest to the other. A cut side starts or ends with "…", which counts toward the 400, and never splits a word.
- Empty when neither side has text, or when the anchor text alone leaves less than 2 characters.
- Speed: in Chrome for Testing on a Mac, a scan of 20,000 links took 0.37 s with context and 0.15 s without (`tests/access-content.mjs` records it). Region drags read context only when saving, never while dragging.
- Set by `scan(options)` (`options.context`, default the page's `saveContext`), the card's `capture.commit` (ticked links only), `content.contextLink` and `content.selectionLinks`. Copying, opening, downloading and bookmarking don't read it.
- The background keeps it through `occurrences` (text, spaces collapsed, at most 400 characters; absent when empty). `appendLinks` drops every link's `context` when `saveContext` is `false`, whatever the page sent. *Capture this page* sends the setting as `scan`'s argument (`{context}`).

**`saveContext`.**
- It reaches the page script in `settings.get` and in `content.configure`'s `capture` (it joined `CAPTURE_FIELDS` in `background/hold.js`); a change reconfigures open tabs.
- In the rail, under *After a drag*: `#save-context`, a checkbox labeled "Save the words around each link", described by `#save-context-help`. Restore previews name the setting.

**Reading citation tags.** `pageCitation()` in the page script and `readCitationTags()` in `background/citations.js` are the same code; the second stands alone for `chrome.scripting.executeScript`. `tests/access-content.mjs` checks that they agree on every fixture.
- Meta tags come from the first 2,000 `meta[name][content]`, names compared ignoring case.
- Beyond the list above:
  - Highwire: `citation_authors` (split at semicolons) when there is no `citation_author`.
  - PRISM: the title, authors and publisher come from Dublin Core (`dc.title`, `dc.creator`, `dc.publisher`, or their `dcterms.` names); the date from `prism.publicationDate` or `prism.coverDate`, then `dc.date`. `prism.endingPage`, `prism.issueIdentifier`, `prism.publisher` and `prism.isbn` are read too.
  - Dublin Core: `dcterms.` names count as `DC.` ones (`dcterms.issued`, `dcterms.date` or `dcterms.created` for the date). A DOI comes from an identifier written as `10.…`, `doi:10.…`, `info:doi/10.…` or a doi.org address.
- JSON-LD:
  - The first 20 `script[type*="ld+json" i]` of at most 1,000,000 characters; bad JSON is skipped.
  - Nodes are found in arrays and `@graph`, 4 levels deep. A reference (`{"@id": …}` alone) is followed once within the page.
  - Types, with or without the `https://schema.org/` prefix: the four above plus schema.org's common kinds of article (`MedicalScholarlyArticle`, `NewsArticle`, `BlogPosting`, `TechArticle`), so blog and news posts count.
  - Fields: title from `headline` or `name`; authors from `author` (`name`, or given and family names); date from `datePublished` or `dateCreated`; `publisher`'s name; `pageStart`, `pageEnd`, `isbn`.
  - Journal, volume and issue come from `isPartOf`, through `PublicationIssue` (`issueNumber`), `PublicationVolume` (`volumeNumber`) and `Periodical` (`name`).
  - A DOI only from `identifier` (a `PropertyValue` whose `propertyID` says DOI, or a DOI written as text) or `sameAs` (a doi.org address).
- Limits:
  - Each value is read from at most 10,000 characters, spaces collapsed.
  - Title, journal and publisher are cut to 300 characters at a word boundary with "…".
  - A date over 40 characters, any other value over 300, and author names over 200 are left out; at most the first 50 authors are kept.
  - `citation_pdf_url` is resolved against the page, and kept only as an HTTP(S) address of at most 2,000 characters.
  - Nothing throws: what can't be read is left out, and a page with no usable title gives `null`.
- The reading is `{title, authors?, date?, journal?, publisher?, volume?, issue?, firstPage?, lastPage?, doi?, pmid?, arxiv?, isbn?, pdfUrl?}` as printed, or `null`.

**Saving citations.**
- The page's reading goes as `page` in `scan`'s result and in `capture.commit`, and in the menus' answers: `content.contextLink` answers `{link, page}`, and `content.selectionLinks` answers `{links, warnings, page}`.
- `citationPages(page, url)` (`background/citations.js`) turns it into `{[pageKey(url)]: PageCitation}`, keyed by the tab's address (or the links' `sourceUrl` where Chrome hides it):
  - known fields only, with the model's limits (a title, journal or publisher is cut; anything else too long is left out);
  - `doi` as identifiers read it (`doiIn`), `pmid` as digits (`PMID: 42` becomes `42`), `arxiv` without `arXiv:`, `pdfUrl` only as an HTTP(S) address;
  - `readAt`, the time it was read;
  - no title, no citation.
- `appendLinks(links, {pages})` passes them to `links.append`, even when every link was skipped as already saved, so a newer reading of the page replaces the older. If the model refused a citation, the links would still be saved without it.
- One citation per scanned document: *Capture this page* and tab captures (per tab), the card's commit, *Add link* and *Capture links in the selection*.

**Save tabs as links.**
- For each web page in the save (one per address), `permissions.contains({origins: [origin + '/*']})`, asked once per origin, decides whether Link Meteor already has access: all sites, or that site. The tab a person just acted on is tried as well: the right-clicked tab for a menu save, and This page's tab from the workbench. Chrome gives temporary access to it, and if reading still fails it counts as needing access. Other tabs never use temporary access.
- Where it has access, `executeScript({target: {tabId}, func: readCitationTags, injectImmediately: true})` reads the tags, 8 tabs at a time, each given 3 seconds. A discarded tab, or one that fails or doesn't answer in time, is not read. Nothing asks for access.
- Each tab's citation is kept under its own address, so each saved link has its own citation.
- The report gains `citations: {tabs, read, found, needAccess}`: the web pages in the save, those whose tags were read, those that had a citation, and those without site access.
- The report (`.report-citations`, under its title) and the menus' notice add one sentence after the summary: "Read citation details from 12 of 45 tabs; the others need site access."
  - Other forms: "Read citation details from all 45 tabs.", "Read the tab’s citation details.", "Read no citation details; the tabs need site access.", and "the other needs site access".
  - When tabs with access didn't answer: "didn’t answer", or "need site access or didn’t answer".
  - *Save this tab as a link* from a menu adds "Read its citation details." only when the page had a citation.

### Identifiers (`src/core/identifiers.js`, pure)

`identifiersOf(link, pages?)` returns `{doi?, arxiv?, pmid?, pmcid?, isbn?}`, found in `url` and `originalHref`, and in the citation the link uses (its own page's, or since release candidate 2 one borrowed from a page about the same work: see `citationFor` below). They are derived each time, never stored.
- **DOI:** Crossref's pattern (`10.` followed by 4 to 9 digits, `/` and a suffix of letters, digits and `-._;()/:`), from `doi.org/…`, `dx.doi.org/…`, `/doi/…` paths and `doi=` query values. Percent-encoding is decoded, trailing punctuation is trimmed, and DOIs compare ignoring case. An arXiv DOI (`10.48550/arXiv.<id>`) also gives the arXiv ID.
- **arXiv:** new-style `YYMM.NNNN(N)` and old-style `archive/YYMMNNN`, with an optional `vN`, from `arxiv.org/abs/…` and `arxiv.org/pdf/…`.
- **PubMed:** a PMID from `pubmed.ncbi.nlm.nih.gov/<id>/` and `ncbi.nlm.nih.gov/pubmed/<id>`; a PMCID `PMC<digits>` from `pmc.ncbi.nlm.nih.gov/articles/…` and the older `ncbi.nlm.nih.gov/pmc/articles/…`.
- **ISBN:** ISBN-13 (978 or 979, weights 1 and 3) or ISBN-10 (weights 10 to 1, check digit 0 to 9 or X) with a valid check digit, from `/isbn/…` paths (Open Library, WorldCat) and `isbn=`, `ean=` or `vid=ISBN` values. Shop product codes are not read as ISBNs.

### Reading status, star and Insights in the workbench

- **Link details** open with a *Reading* row (Unread, Reading, Read, and a *Star* toggle), then *Context*, *Identifiers* (each with Copy) and *Cited from* (the source citation), above the existing facts.
- **Rows** show a star, *Reading* or *Read*, and the identifier kind as badges.
- **Selection:** *Mark as read*, *Mark as unread* and *Star* for the selected links, with Undo.
- **View:** *Reading* (Any, Unread, Reading, Read) and *Starred only*, shown as chips like the other view options.
- **Insights** (`src/core/insights.js`, pure; `insights(links, pages)`): a *Links* or *Insights* switch in the list heading shows, for the whole collection:
  - totals: links, unique addresses, sites, pages captured from, links with an identifier, starred;
  - top sites and file types, with counts;
  - other sites or the same site;
  - reading status;
  - addresses saved more than once, and how many under different anchor text;
  - captures over time, by week, for up to 26 weeks.

  Choosing a site, file type, status or *Starred* shows those links in the list, as a view option.

#### Reading status, star and Insights, as built

**Link details.** Each occurrence (`.occurrence`) opens with `.occ-new`, full width above `.facts` at every size:
- `.reading` (a group labeled "Reading status and star for <label>"):
  - `.status-seg`, a radio group labeled "Reading status": radios named `status-<link id>` with values `''` (Unread), `reading` and `read`, marked `data-link-field="status:<value>"`;
  - `.star-btn`, a toggle with `aria-pressed`, reading "Star" (`data-link-field="star"`). Until release candidate 2 it switched to "Starred".

  A change sends `links.status` or `links.star` for that link at once. The notice says "Marked “the canopy study” as read." or "Starred “the canopy study”.", with Undo. Keyboard focus stays on the control when the list is drawn again.
- Then, only when the link has them, labeled groups (`.occ-block`, label `.occ-label`):
  - *Context*: `blockquote.context` with the anchor text in a `mark` (its first exact match, else ignoring case), and `.context-meta`: "The words around the link on “<source title or host>”, as captured. Saved in this browser."
  - *Identifiers*: `ul.idents`, one `.ident` per kind in `IDENTIFIER_LABELS` order: the label, the value and *Copy* (labeled "Copy DOI 10.5555/…"; the notice says "Copied the DOI."). A DOI's value is a link to `https://doi.org/<doi>` (`target="_blank"`, `rel="noopener noreferrer"`), opened only when clicked; other values are text.
  - *Cited from*: `.cited` with `.cited-title` ("Untitled page" without one), `.cited-line` (authors, the first three and "and N more authors" past four; the journal, else the publisher, with vol., no. and pp.; the date as printed; DOI, arXiv, PubMed and ISBN; joined by " · ") and `.cited-note` ("From the source page’s own citation tags, read when you captured it. Saved in this browser; nothing was looked up online."). It shows `pages[pageKey(link.sourceUrl)]`; for a saved tab that is the tab's own page.
  - *Imported from*: `.imported-from`, the link's `imported` text.

**Row badges**, in order after the anchor text: `×N`, `.badge.star` (a star icon and "Starred"), `.badge.status` ("Reading" or "Read"), EMAIL or PHONE, the file type, one `.badge.badge-id` per identifier kind (DOI, arXiv, PubMed, PMC, ISBN) and `.badge.imported`. The new badges are written in sentence case and shown in capitals. A grouped row shows the star when any occurrence is starred, a status only when every occurrence has it, its first occurrence's identifiers, and Imported when any occurrence was imported.

**Selection.** `#reading-actions` (a group in the list toolbar, after the selection count) shows while links in the view are selected: `#mark-read`, `#mark-unread` and `#star-selected` (`#star-selected-label` reads "Unstar" when every selected link is starred, otherwise "Star").
- They act on the selected links in the view, as Remove does, and send one action for the links whose value changes. When none changes, nothing is sent and the notice says "The selected link is already read." or "All 3 selected links are already read."
- Notices: "Marked 3 links as read.", "Starred 3 links.", "Unstarred 3 links.", each with Undo. Undo sends one action per distinct earlier value, as Fill does, and says "Put back the earlier reading status of 2 links." or "Put back the earlier stars of 2 links."

**View options.**
- In `#filter-panel`: `#status-filter` (Reading: `any`, `unread`, `reading`, `read`) and `#starred-filter` (Starred only). `#type-group` is a hidden input holding the type group chosen in Insights.
- They pass `status`, `starred` and `typeGroup` to `queryLinks`.
- Chips: "Reading status: Read", "Starred only" and "Type: PDF". Reset view and *Clear search and filters* clear them.
- An export's About filters list them: "Reading status: Read", "Starred links only", "Type: PDF".

**Insights** (`src/ui/workbench/insights.js`):
- **The switch.** `#view-switch` (a group labeled "Show links or insights", with `#show-links` and `#show-insights`, each with `aria-pressed`) stands in for the list heading. `#review-title` stays for screen readers ("Links" or "Insights"), and it shows only while the collection is empty; then the switch hides and the list shows.
- **The view.** Insights adds `.is-insights` to `#review`, which hides everything but the heading and `#insights`, and `#result-count` reads "For the whole collection". "/" shows the list and focuses its search.
- **The cards** (`.insight`; headings `#insight-top-sites`, `#insight-file-types`, `#insight-other-sites-or-the-same-site`, `#insight-reading`, `#insight-saved-more-than-once`, `#insight-captures-over-time-by-week`), all from `insights(links, {pages, limit: 12})`:
  - totals (`.totals`): links, unique addresses, sites, pages captured from, with an identifier, and starred;
  - top sites: the 8 with the most links, with a note when there are more;
  - file types;
  - other sites or the same site: a split bar, and a legend with counts and percentages of all links, adding "Email, phone or no source page" when there are any;
  - reading: Unread, Reading and Read;
  - saved more than once: the top 5 addresses, and "N addresses were saved more than once; M of them under different anchor text.";
  - captures over time, by week: one column per week, drawn to scale against the busiest week (an empty week has no column), an axis with the first week, "Peak: N links, week of <date>" and the last week, a note that weeks run Monday to Sunday in UTC (and how many links fall outside them), and a list of every week for screen readers.

  Bars are drawn to scale against the largest in their card.
- **Choices** are buttons (`.bar-row`, and the starred total), described by `#insights-choose-help`. Rows with a count of 0 aren't buttons.
  - A site sets Domain to its host. Domain matches hosts that contain it, as always, so choosing `example.org` also shows `journal.example.org`.
  - A file type sets `#type-group`, a status sets Reading, and Starred sets Starred only.
  - Choosing clears the search and the other filters (sorting and grouping stay), shows the list and focuses `#show-links`.
- **Drawing.** The cards are drawn when Insights opens, and again only when the collection's `updatedAt` or link count changes while it's shown. Keyboard focus stays on the same choice across a redraw. A capture's *Show only these links* shows the list.

**Stable element IDs:** `#view-switch`, `#show-links`, `#show-insights`, `#insights`, `#insights-choose-help`, `#reading-actions`, `#mark-read`, `#mark-unread`, `#star-selected`, `#star-selected-label`, `#status-filter`, `#starred-filter`, `#type-group`.

**Tests:** `tests/reading-browser.mjs` (no grants) covers these from the keyboard, Undo, the view options against `queryLinks`, Insights against `insights()`, 320 px and contrast in light and dark. `tests/visual-browser.mjs` measures the new badges, details and Insights in every theme and scheme, at 320 px, with screenshots.

### Exports

**New columns** for tables, CSV, TSV, Excel, HTML and JSON: `context` (Context), `status` (Reading status: Unread, Reading or Read), `starred` (Starred: Yes or empty), `doi` (DOI), `arxiv` (arXiv ID), `pmid` (PubMed ID), `isbn` (ISBN) and `imported` (Imported from). Identifier columns are derived per link.

**Citation formats** in the Format list, under *Citations and notes*. Each writes one entry per row of the view or selection (grouped rows use their first occurrence) and never looks anything up:

| Format | Extension | Entry |
| --- | --- | --- |
| `bibtex` | `.bib` | `@article` when the link's citation has a journal, otherwise `@misc`, as Zotero writes web pages: `title`, `author`, `year`, `howpublished` (only for an arXiv preprint: `arXiv preprint arXiv:<id>`), `journal`, `volume`, `number`, `pages`, `doi`, `eprint` with `archivePrefix = {arXiv}` (as arXiv's own export does), `isbn`, `url`, `urldate`, `note` (the link's note) and `keywords` (its tags). Otherwise no `howpublished`, so the address isn't printed twice. Keys are the first author's family name or the title's first word, plus the year, made unique with `a`, `b`… Escaping follows Zotero: `# $ % & _` get a backslash; `\ ~ ^ { }` and `< > |` become macros or escaped braces; `url` and `doi` stay raw. |
| `ris` | `.ris` | `TY  - JOUR` when there is a journal, `UNPB` for an arXiv preprint, otherwise `ELEC`; `TI`, `AU` (one per author), `PY`, `DA`, `T2`, `PB` and `AN` (a preprint's `arXiv` and `arXiv:<id>`), `VL`, `IS`, `SP`, `EP`, `SN` (the ISBN), `DO`, `UR`, `Y2` (the capture date, as `YYYY/MM/DD/`), `N1` (the note), `KW` (one per tag) and `ER  - `. Each line is a two-letter tag, two spaces, a hyphen and a space; CRLF line endings. |
| `csl` | `.json` | An array of CSL-JSON items with `id` and `type` (`article-journal`, `article` for an arXiv preprint, or `webpage`), `title`, `author` (split into family and given names when printed as "Family, Given", otherwise `literal`), `issued`, `container-title`, `publisher` and `number` (a preprint's `arXiv` and `arXiv:<id>`), `volume`, `issue`, `page`, `DOI`, `PMID`, `PMCID`, `ISBN`, `URL`, `accessed` (`date-parts`), `note` and `keyword`. `container-title` is the journal, or for a web page the source site's name; a preprint has none. |
| `annotated` | `.md` | An annotated bibliography: the collection's name, then per link a citation line (authors, year, title, journal, DOI or address), its note, its context as a quote, and its tags. |
| `obsidian` | `.md` | An Obsidian note: YAML front matter (`title`, `created`, `tags`, `source: Link Meteor`), then one list item per link, `[anchor text](url)`, with its note, custom columns as `name:: value` fields, and its context as an indented quote. |

The title is the title of the citation the link uses when there is one, otherwise its anchor text, accessible label or address, in that order. Authors, dates, journals and pages come only from that citation: the link's own page's, or since release candidate 2 one borrowed from a saved page about the same work. The Export panel says how many entries have a DOI or arXiv ID and how many have authors and a date, and shows the first entry.

#### Exports, as built

**Columns** (`src/core/export.js`):
- `COLUMNS` gains, after Tags: `context` (Context), `status` (Reading status), `starred` (Starred), `doi` (DOI), `arxiv` (arXiv ID), `pmid` (PubMed ID), `isbn` (ISBN) and `imported` (Imported from). *Add a column…* lists them in that order.
- Cells: `status` is `Unread`, `Reading` or `Read`; `starred` is `Yes` or empty; each identifier column is `identifiersOf(row, pages)`, found once per row; `context` and `imported` as stored. CSV and TSV put an apostrophe before formula-looking text, as for every column; workbook cells stay text and only the URL columns link.
- `makeExport(rows, {format, columns, about, fields, pages})`: `pages` (default `{}`) is the collection's page citations; anything but an object is refused. Downloads and Copy table pass the collection's `pages`.
- JSON rows keep `context`, `status`, `starred` and `imported` as stored. Identifiers are derived, so JSON doesn't add them.

**Citation formats** (`src/core/cite.js`, pure; it imports only `identifiers.js`):
- `CITE_FORMATS` is `['bibtex', 'ris', 'csl', 'annotated', 'obsidian']`. Extensions: `bib`, `ris`, `json`, `md`, `md`. Types: `application/x-bibtex`, `application/x-research-info-systems`, `application/vnd.citationstyles.csl+json` and `text/markdown`, each with `;charset=utf-8`.
- `citations(rows, {format, pages, fields, collection, date})` returns the file. `citeFirst(rows, options)` returns the first entry exactly as the file writes it (for CSL-JSON, the first item on its own). `citeFacts(rows, pages)` returns `{entries, identified, unauthored, authorsAndDate, pageTitles, addressTitles, notes, contexts}`; `unauthored` (release candidate 3) counts entries with a DOI or arXiv ID and no authors. `dateParts(text)` returns `[year, month?, day?]`.
- With a citation format, `makeExport` ignores `columns` and takes the collection's name and the export time from `about` (checked as usual). Without `about`, there is no name and no export time.
- **Every entry:**
  - The title is the `title` of the citation the link uses, else its anchor text, accessible label or address, with spaces collapsed.
  - Authors, date, journal, volume, issue and pages come only from the citation the link uses: its own, `pages[url without #fragment]`, or (release candidate 2) one borrowed with `citationFor`. The source page's citation is never used for the link just because the link was captured there.
  - (Release candidate 2) An arXiv entry with no date takes the year and month of its ID (`arxivDate`), and one without a journal is an arXiv preprint in every format.
  - Dates as printed: year-first numbers (`2025-03-14`, `2025/03`, also inside other text), month names (`14 March 2025`, `March 14, 2025`, `2019 Aug 23`) and a lone year. Day-first or month-first numbers (`03/04/2025`) give only the year. The access date is the local calendar date of `capturedAt`.
  - Names are split into family and given names only when printed with exactly one comma ("Okafor, Amara").
  - Keys (BibTeX keys and CSL `id`s): the first author's family name (a name printed without a comma gives its last word), else the title's first word with a letter, skipping *a*, *an* and *the* (for a title that is the address, the site's first label); lowercase ASCII letters and digits, accents folded; then the year; `link` when nothing is left. Repeats get `a`, `b`… `z`, `aa`… in row order.
- **BibTeX:**
  - Fields in this order: `title, author, year, howpublished, journal, volume, number, pages, doi, eprint, archivePrefix, isbn, url, urldate, note, keywords`. `@article` when the link's own citation has a journal, otherwise `@misc`.
  - Layout: two spaces, the field name padded to 12, ` = {value}`, one field per line; a blank line between entries; a final newline; an empty file for no rows. Every value is on one line.
  - Escaping as Zotero writes it: `# $ % & _` get a backslash; `\ ~ ^ < > |` become `{\textbackslash}`, `{\textasciitilde}`, `{\textasciicircum}`, `{\textless}`, `{\textgreater}` and `{\textbar}`; `{` and `}` become `\{\vphantom{\}}` and `\vphantom{\{}\}`, so braces stay balanced.
  - `url` and `doi` stay raw, except that `{`, `}`, `\` and spaces are percent-encoded, so a brace in an address can't unbalance the entry.
  - `author`: "Family, Given" as printed (a part containing the word "and" is braced); any other name is braced whole, `{Jun Watanabe}`, so readers keep it as one name. `pages` uses `--`. `eprint` is the arXiv ID with its version, if the address has one. `note` is the link's note; `keywords` its tags, joined with ", ".
  - Titles (release candidate 2): a word with a capital letter after its first character (an acronym, `3D`, `COVID-19`, `iPhone`) is braced, `{DNA}`, so classic styles keep it as written. Other capitals stay free.
  - Not written: `month`, `publisher`, and PubMed and PMC IDs (BibTeX has no standard field for them).
- **RIS:**
  - Tags in this order: `TY, TI, AU…, PY, DA, T2, PB, AN, VL, IS, SP, EP, SN, DO, UR, Y2, N1, KW…, ER`. `PY` is the year. `DA` is `YYYY/MM/DD/`, or `YYYY/MM//`, when the month is known. `Y2` is the access date as `YYYY/MM/DD/`. `T2` is the journal only. `EP` is written only with a different first page.
  - Values are on one line and empty ones are left out. `ER  - ` ends every record, records are separated by a blank line, every line ends with CRLF, and no rows give an empty file.
  - Not written: the PubMed and PMC IDs, which RIS has no standard tag for. An arXiv ID is written only for a preprint, as `AN  - arXiv:<id>`.
- **CSL-JSON:**
  - The array, indented by two spaces, with each date's parts on one line (`"date-parts": [[2025, 3, 14]]`), and a final newline; `[]` for no rows.
  - Keys in this order: `id, type, title, author, issued, container-title, publisher, number, volume, issue, page, DOI, PMID, PMCID, ISBN, URL, accessed, note, keyword`. `issued` is `date-parts` when a year is found, otherwise `{literal}`. A web page's `container-title` is its site, the link's own host without `www.`, and none for `doi.org`. `page` uses a hyphen. `note` keeps its line breaks. `keyword` is the tags joined with ", ".
- **Annotated bibliography:**
  - `# <collection name>` (or `# Links`), then "An annotated bibliography of 16 links, exported from Link Meteor on 2026-09-29.", then a numbered list.
  - Each item starts with its citation: `Authors; joined (2025). Title. *Journal*, 12(3), 45–52. <https://doi.org/…>`, or without authors `Title. (2025).`; a preprint has `arXiv preprint arXiv:<id>.` in place of the journal; the link is the DOI's `https://doi.org/` address when there is a DOI, otherwise the link's address. A title that is the address is written once, as the link.
  - Then, indented under the number, each line of the note as its own paragraph, the context as a `>` quote, and `Tags: a, b`.
- **Obsidian note:**
  - Front matter: `title` (quoted), `created` (the export time, local, `YYYY-MM-DDTHH:mm`), `tags` and `source: Link Meteor`. `tags` lists every link's tags as Obsidian tags, quoted: spaces become hyphens, characters other than letters, digits, `_`, `-` and `/` are dropped, tags of digits only are left out, and the first spelling of each is kept; `tags: []` when there are none.
  - One list item per link: `- [anchor text](address)` (the accessible label, then the citation title, then the address when there is no anchor text), then its tags as `#tag`. Indented two spaces under it: the note's lines, `Preprint:: arXiv:<id>` for an arXiv preprint (release candidate 2), each filled custom column as `Name:: value` (the value raw and on one line; `::` in a name becomes `:`), and the context as a `>` quote. Link addresses percent-encode `< > ( ) [ ] \` and spaces.
- **Markdown escaping**, in both Markdown formats: page text, notes and tags get a backslash before `` \ ` * _ [ ] < > # | ~ $ ``, `==` and `%%` are broken up, and a line never starts with a bare `-`, `+`, `=` or `1.`. So text reads as written and never becomes formatting, a link, an Obsidian tag, a highlight, a comment or math.

**The Export panel:**
- `#format` ends with `<optgroup label="Citations and notes">`: `bibtex` "BibTeX (.bib)", `ris` "RIS (.ris)", `csl` "CSL-JSON (.json)", `annotated` "Annotated bibliography (.md)" and `obsidian` "Obsidian note (.md)".
- Choosing one hides `#columns-fieldset` and shows `#cite-block` (hidden while the view has no links): `#cite-facts` (list items, with each number in `<b>`), `#cite-first-label` ("First entry"; "First record" for RIS; "First list item" for the Obsidian note) and `#cite-first`, a `pre` with `role="region"` named by the label and `tabindex="0"`, so it scrolls from the keyboard; it is at most 190 px high.
- The facts, for BibTeX, RIS, CSL-JSON and the annotated bibliography: "16 entries, one per link" ("one per unique address" or "one per unique address and anchor text" when grouped; "selected" is added with a selection), "5 with a DOI or arXiv ID", "2 with authors and a date, read from the pages themselves", and how titles are made: "14 use the anchor text as the title" (adding ", or the address when there is none"), "Titles are the anchor text" or "Every title comes from the page itself". For the Obsidian note: "16 list items, one per link", "3 with a note", "4 with the words around the link on its page" and "2 custom columns as name:: value fields, where filled in".
- The download button reads "Download BibTeX file", "Download RIS file", "Download CSL-JSON file", "Download annotated bibliography" or "Download Obsidian note". The file name follows the usual pattern with the format's extension. The entries are the export's rows (`targetRows()`): the view or the selection, with grouped rows using their first occurrence.

### Imports

- **Sources:**
  - a file, up to 20 MB: CSV, TSV, Excel (`.xlsx`, the first sheet or a chosen one), a text or Markdown list, an HTML page or browser bookmarks file, or a Link Meteor JSON export;
  - pasted text: addresses, Markdown links or HTML;
  - a Chrome bookmark folder, with or without its subfolders, through the optional `bookmarks` permission that 0.3.0 added.
- **Parsing (`src/core/imports.js`, pure):**
  - `parseDelimited(text, delimiter)`: RFC 4180 quoting, a leading byte-order mark ignored, CRLF or LF;
  - `parseList(text)`: one link per Markdown link or bare `http(s)`, `mailto:` or `tel:` address;
  - `readXlsx(bytes, {inflateRaw, parseXml})`: the workbook's sheets as rows of text, with shared and inline strings, numbers as written, and formulas as their cached values, never evaluated. The workbench supplies `DecompressionStream('deflate-raw')` (Chrome 103 and later) and `DOMParser`.
  - HTML is read with `DOMParser` in the workbench: every `<a href>`, with its text and its folder path in a bookmarks file.
- **Mapping:** `planImport(rows, mapping, {links, skipSaved})` returns `{links, newFields, skipped: [{row, reason}]}`.
  - The mapping names the address column (required), and optionally anchor text, notes, tags, reading status, starred, and existing or new custom columns.
  - *First row is column names* is detected and can be changed.
  - Rows are skipped, each with its reason: no address; an address that isn't a web, email or phone address; a repeat of an earlier row (same address and anchor text); already saved, with *Skip links already saved there*. At most 20,000 links per import.
- **Imported links:** `anchorText` as mapped, or empty; `url`; `originalHref` as written in the file; empty `sourceUrl`, `sourceTitle` and `frameUrl`; `capturedAt` the import time; one `batchId` per import; `imported`; and the mapped notes, tags, status, star and custom values. Rows and details show *Imported*.
- **Messages (workbench only):**
  - `import.commit {collectionId?, newCollection?, links, newFields}` adds the links as one batch, creating the collection and columns first, and returns `{state, batchId, collectionId}`;
  - `import.undo {collectionId, batchId}` removes that batch and anything the import created, refused if the batch changed since;
  - `bookmarks.folderLinks {folderId, recursive}` returns `{links: [{title, url, path}]}`.

#### Imports, as built

**Reading** (`src/core/imports.js`, pure; it imports only limits from `model.js`):
- Limits: `MAX_IMPORT_BYTES` (20 MB per file), `MAX_IMPORT_LINKS` (20,000 links per import) and `MAX_XLSX_PART` (150 MB for one workbook part once unpacked).
- `decodeText(bytes)`: UTF-16 with a byte-order mark, else UTF-8 (a UTF-8 mark is dropped), else Windows-1252.
- `parseDelimited(text, delimiter = ',', {onProgress?})`: as the contract says. A quote inside an unquoted field is text, and text after a closing quote joins the field. An unterminated quote runs to the end. `onProgress(rows)` is called every 10,000 rows.
- `sniffDelimiter(text)`: tab, comma or semicolon, whichever the first line with text holds most of outside quotes; comma when none. A `.csv` file is read with it, so semicolon files from European spreadsheets work.
- `readText(text, {kind, delimiter, onProgress})`: `{kind: 'table', rows, delimiter}` or `{kind: 'list', entries}`. `kind: 'text'` (`.txt` files and pasted text) is a tab-separated table when its first line with text holds a tab (cells copied from a spreadsheet), otherwise a list.
- `parseList(text)`: `[{anchorText, href, line}]`, in reading order.
  - Markdown links keep their label, with backslash escapes removed. A `<…>` address and a title are allowed.
  - Bare addresses lose trailing `. , ; : ! ? * ' "`, curly quotes, `»`, `›` and `…`, and closing brackets they don't open.
  - A line with a single bare address uses the words around it, without list markers, check boxes and separators, as its anchor text.
- `readXlsx(bytes, {inflateRaw, parseXml, sheet = 0})`: `{sheets: [name], sheet, rows, numbers}`. It reads only the chosen sheet, whose part it finds through the package and workbook relationships (any namespace prefix, relative or absolute targets, part names in any case). Details:
  - Rows with no text are left out, and `numbers` gives each kept row's number in the sheet.
  - Cells are placed by their references.
  - Shared and inline strings are joined from their runs, without phonetic guides, and Excel's `_xHHHH_` escapes are decoded.
  - Numbers are as stored, so a date is its serial number. Booleans are `TRUE` or `FALSE`, and errors are as shown (`#DIV/0!`).
  - A formula is its cached value, and empty without one.

  It refuses, each with a reason:
  - an older `.xls` or a password-protected workbook (both start with the OLE signature);
  - encrypted ZIP entries;
  - the large-file ZIP format;
  - compression other than stored or deflate;
  - a part over `MAX_XLSX_PART`;
  - a missing workbook, a workbook without sheets, a chart sheet;
  - XML that doesn't parse.
- `readExportJson(text)`: a Link Meteor JSON export (an array of rows, or `{about, rows}`) as `{names, rows}` with the export's own column names: Anchor text, URL, Notes, Tags, Reading status, Starred, then its custom columns by `about.fields`. A backup is refused with where to restore it. Any other JSON is refused.
- `detectHeader(rows)`: the first row with text names the columns when it holds no address and either a known column name (the names below, or one of Link Meteor's export columns) or text above a column whose later rows hold addresses.
- `columnNames(rows, header)`: the header's cells, with blanks as `Column C` and repeats as `Notes (2)`. Without a header, the column letters.
- `dataRows(rows, header)`: the rows with text, after the header row.
- `guessMapping(names, rows, {fields, skip})`: `{url, anchorText, notes, tags, status, starred, fields: [{id, column}], fresh: [{column, name, use}], overflow}`. How it chooses:
  - By name, lowercased with punctuation as spaces, most likely first:
    - address: url, address, link, links, href, uri, web address, website, web site, webpage, web page, link url, page url, homepage;
    - anchor text: anchor text, title, name, link text, text, label, anchor, page title, link title;
    - notes: notes, note, comments, comment, description, annotation, annotations, remarks, summary;
    - tags: tags, tag, keywords, keyword, labels, categories, category, topics;
    - reading status: reading status, status, read status, reading;
    - starred: starred, star, stars, favorite, favourite, favorites, favourites.
  - A named address column holding no addresses gives way to the column with the most. Without a name, the column with the most addresses is the address, and the first column of words among `Column X` columns is the anchor text.
  - The destination's own columns match by name, ignoring case.
  - Every column left over is proposed as a new column (`fresh`), up to the collection's room for custom columns (`overflow` counts the rest). A proposal isn't chosen (`use: false`) when the column is empty, is one of Link Meteor's export-only columns (Accessible label, Original href, Source page URL, Source page title, Frame URL, Captured at, Capture batch ID, Occurrence ID, Context, DOI, arXiv ID, PubMed ID, ISBN, Imported from), or is in `skip` (a bookmarks source's Folder column). New names are cut to 60 characters and kept distinct from the destination's.
- `importAddress(value)`: `{url}` or `{reason}`.
  - The cell is trimmed and loses wrapping `<…>`, and `www.` gets `https://`.
  - The URL parser's `href` is stored, so `https://Example.org` becomes `https://example.org/`.
  - Only `http:` and `https:` with a host, and `mailto:` and `tel:` with a path, are links.
- `readingStatus(value)`: `read` for read, done, finished or completed; `reading` for reading, in progress, started or currently reading; otherwise unread. `starredValue(value)`: yes, y, true, 1, x, starred, star, ✓, ✔, ★ or ⭐.
- `planImport(rows, mapping, options)` (see the contract) returns `{links, newFields, skipped, counts, cut, preview, previewSkipped}`:
  - Rows with no text are ignored, not skipped. The header is the first row with text.
  - The checks run in this order: no address (`no-address`), not a web, email or phone address (`not-link`), a repeat of an earlier row with the same address and anchor text (`repeat`, with `of`, the earlier row's number), already saved (`saved`, with `skipSaved`), then the limit.
  - Rows after the 20,000th link are one entry, `{row, reason: 'limit', rows}`.
  - `counts` has `rows`, `links` and a count per reason. `preview` and `previewSkipped` describe the first `preview` rows (default 100) with their mapped values.
  - Links:
    - Anchor text has its spaces collapsed, and notes are trimmed.
    - Tags are split at commas and semicolons, with repeats removed.
    - `originalHref` is the address cell exactly as written, or `options.originals[row]`, the `href` attribute as written for HTML.
    - A custom value over 2,000 characters is cut, ending in `…`, and counted in `cut`.
    - Existing columns are keyed by id, and new ones by `new-1`, `new-2`… in `newFields: [{key, name}]`.
  - `imported` is `<source>, <unit> <number>` (`labs-shortlist.csv, row 3`, `notes.md, line 4`, `Pasted links, link 2`), or `<source> › <folder path>` for bookmarks, cut to 300 characters. A workbook with several sheets adds the sheet: `labs.xlsx › Sources, row 3`.

**The background** (`src/background/imports.js`, and `src/background/bookmarks.js`):
- `import.commit {collectionId? | newCollection?, links, newFields?, skipSaved?}` => `{state, batchId, collectionId, count, skipped, fields}`.
  - Exactly one destination. A new collection's name has its spaces collapsed and is cut to 120 characters. An existing destination becomes the active collection, as a new one does.
  - `newFields` keys must look like column ids, and must be distinct. Each is added with `fields.add`, so the model's name rules and the 20-column limit apply.
  - Every link is built again from what an import may set: anchor text, address, address as written, notes, tags, `imported` (required, at most 300 characters), status, star and custom values for the destination's columns or the new keys. It gets a new id, one new `batchId` and the import time as `capturedAt`. Empty source fields and the accessible label are empty, whatever the message held. The model then checks each link as for any append.
  - With `skipSaved`, addresses the destination holds are dropped here too (`skipped`). Nothing left is refused ("Every link is already saved there").
  - One state write, so a refusal or a failed write changes nothing. The Undo record is kept at session key `linkMeteorImports` (the latest 10): `{batchId, collectionId, createdCollection, fields, previousActive, count, digest, createdAt}`, where `digest` is a SHA-256 of the batch's links with sorted keys.
- `import.undo {collectionId, batchId}` => `{state, count, collectionRemoved, fieldsRemoved}`.
  - It removes the import's collection when the import created it. Otherwise it removes the batch (the list's own removal Undo is kept) and the columns the import created.
  - If the import's collection is still the active one, the collection that was active before the import becomes active again.
  - It is refused when:
    - the record is gone (the browser restarted, or 10 newer imports);
    - the collection no longer exists;
    - the batch's links differ from what was written: count, notes, tags, status, star or any other field;
    - a created collection holds other links, notes or tags;
    - another link has a value in a created column.
- `bookmarks.folderLinks {folderId, recursive = true}` => `{folder: {id, title}, links: [{title, url, path}], more}`.
  - Needs bookmark access. Bookmarks of every kind are listed, up to 50,000; `more` says some were left out.
  - `path` joins the folder names from the chosen folder down: `Research › Labs`.

**The workbench** (`src/ui/workbench/imports.js`, `import-worker.js`):
- *Import links* in the rail, before Backup and restore: *Choose a file…*, *Paste links* and *From a bookmark folder…*. The import view takes the place of Capture and the list in the main column (`.main.is-importing`); at compact widths choosing a source shows the main view.
- **Files** are read by extension:
  - `.csv` is delimited with the delimiter sniffed; `.tsv` and `.tab` are tab-separated;
  - `.xlsx` and `.xlsm` are workbooks;
  - `.txt` and `.text` are text, and `.md` and `.markdown` are lists;
  - `.html` and `.htm` are HTML; `.json` is an export.

  Without a known extension, the content decides: a ZIP is a workbook, `<` starts HTML, `{` or `[` starts JSON, anything else is text. `.xls`, `.xlsb`, `.ods` and `.numbers` are refused with how to save them. A file over 20 MB is refused before it is read. Any refusal closes the view and says "Nothing was imported."
- **Delimited text and lists** are decoded and parsed in a module worker, which reports "Reading labs.csv: 20,000 rows so far…". The page parses by itself only if the worker can't start.
- **HTML**, a page or a bookmarks file, is read with `DOMParser`. Each `<a href>` gives its text, else its `aria-label`, `title` or image `alt`.
  - A relative address is resolved against the page's `<base href>`, or the address in a saved page's `<!-- saved from url=… -->` comment. Otherwise it stays as written, and the preview skips it.
  - In a Netscape bookmarks file (Chrome, Firefox, Safari and Edge exports), each link also gets its folder path from the `<H3>` headings, and its `TAGS` and `<DD>` description. These fill the *Folder*, *Tags* and *Notes* columns when any link has them. Folder isn't chosen as a new column; it is in `imported`.
- **Pasted text**:
  - HTML copied from a web page is used when the clipboard held it and the text is unchanged since the paste, so links keep their anchor text.
  - Otherwise, text holding `<a href=` is HTML, and anything else is `readText` with `kind: 'text'`.
- **A bookmark folder:** the click asks `chrome.permissions.request({permissions: ['bookmarks']})` before anything is awaited. A decline closes the view and says so. Folders are listed with `bookmarks.folders` and searched as in *Save as bookmarks*. *Include subfolders* is on by default, and *Preview links* reads `bookmarks.folderLinks`. The source is `Bookmarks`, so `imported` is `Bookmarks › Research › Labs`.
- **The mapping:**
  - *First row is column names*, detected, for tables only.
  - One select per part: Address (URL) (required; columns only), Anchor text, Notes, Tags, Reading status and Starred (each with "(none)"). Then the destination's own columns, then a new column per proposal, "Deadline (new column)", with "(skip this column)".
  - Without a header, each option shows the column's first value: "Column B: https://…".
  - Changing the header detection maps again. Changing the destination keeps the link's own parts and maps the custom columns again.
- **The preview:**
  - A table of the first 100 rows (Row, Line or Link; anchor text; address; then each mapped part and column). A skipped row is struck through and names its reason in words ("Repeats row 2"), in a column headed "Skipped because" for screen readers.
  - *Show only skipped rows*, shown when rows are skipped, lists the first 100 of those.
  - A note: "All 7 rows." or "Showing the first 100 of 60,000 rows."
- **The destination** is *A new collection “labs-shortlist”* by default. It is named after the file without its extension, the folder's title or "Pasted links", with " (2)" when a collection has that name already. The existing collections follow. *Skip links already saved there* is on, and disabled for a new collection.
- **The summary:**
  - "Adds 42 links, marked Imported, and 1 new custom column."
  - "Skips 4 rows: 2 have no address, 1 repeats an earlier row, 1 isn’t a web, email or phone address. You can undo the import."
  - Lists count links rather than rows.
  - Cut values are counted too. With nothing to add: "Nothing to add." and what to change.
  - The button says "Import 42 links", and is disabled with nothing to add.
- **After Import**, the view closes and the destination shows with the new rows marked as arrivals. The notice says "Imported 42 links into “labs-shortlist” and added 1 custom column." with Undo. Undo says "Import undone: removed 42 links, the collection “labs-shortlist” and 1 custom column.", or shows the refusal.
- **Cancel and Escape** close the view with "Import canceled. Nothing was added." Focus returns to the source's control, or to the search field at compact widths. The preview is planned again whenever the saved state changes while it is open.
- **Stable element IDs:**
  - the rail: `#import-panel`, `#import-panel-title`, `#import-panel-help`, `#import-file`, `#import-paste`, `#import-bookmarks`;
  - the view: `#import`, `#import-title`, `#import-source`, `#import-progress`, `#import-commit`, `#import-commit-label`, `#import-cancel`;
  - pasting: `#import-paste-step`, `#import-text`, `#import-read-text`;
  - a bookmark folder: `#import-folder-step`, `#import-folder-search`, `#import-folder`, `#import-folder-status`, `#import-subfolders`, `#import-read-folder`;
  - the plan: `#import-plan`, `#import-sheet-row`, `#import-sheet`, `#import-header-row`, `#import-header`, `#import-map` (with `#import-map-url`, `#import-map-anchorText`, `#import-map-notes`, `#import-map-tags`, `#import-map-status`, `#import-map-starred`, `#import-map-field-N` and `#import-map-new-N`), `#import-map-help`, `#import-table`, `#import-table-note`, `#import-only-skipped`, `#import-destination`, `#import-skip-saved`, `#import-summary`, `#import-summary-main`, `#import-summary-skips`.
- **Not in this release:** Excel dates show as their serial numbers, and a bare DOI or `example.org` without `www.` isn't read as an address.

### Theme fix

Ember light's `danger` becomes `oklch(0.42 0.17 355)`, with `danger-wash` `oklch(0.967 0.018 355)` and `danger-line` `oklch(0.86 0.06 355)`, so the Remove buttons no longer look like Ember's orange links. `tests/themes.test.mjs` gains a check that `danger` and `accent-text` stay distinguishable in every theme and color-vision simulation. One pair is allowed, with its reason: Meteor light under the deuteranopia simulation. Meteor stays the 0.3.0 look value for value, and its Remove buttons carry a trash icon and the word Remove.

### Permissions and privacy

**0.5.0 adds no permission.**
- Imports from a bookmark folder use the optional `bookmarks` permission that 0.3.0 added, asked for in the click, as today.
- *Save tabs as links* reads a tab's citation tags only with site access Link Meteor already has; it never asks for more.
- Files to import are read in the browser and never uploaded.
- Context snippets, page citations, reading status and stars are stored with the collections in this browser. They go into backups and exports only when you make them.

`docs/PRIVACY.md`, `site/privacy.html` and `CHROMEWEBSTORE.md` say so in the foundation. The UI says "Saved in this browser" beside the new data, as for notes.

### Automatic backups and settings sync: not in 0.5.0

The plan recommends building these later. Here is what the browser allows, so the design can be decided with the facts.

**Automatic backups to a folder you choose** (File System Access; no manifest permission):
- A folder can be chosen only in a tab, with a click; the full view qualifies. Choosing one in the side panel is unreliable before Chrome 143.
- The choice can be kept, but writing to it later needs the folder access to still be live:
  - access lasts while one of Link Meteor's pages stays open, and for up to 16 hours after the last one closes;
  - after a browser restart, access needs a click again, unless Chrome's "Allow on every visit" option was chosen (Chrome 122 and later). Whether that option is offered to extensions is untested.
- The background worker can't ask for access, so it can't back up on a schedule by itself.
- A workable design writes a backup at most once a day while the full view or the side panel is open. When access has lapsed, it shows "Backups paused: allow the folder again" with a one-click button, and it keeps the last N files by removing only files it named itself.

**Automatic backups to the Downloads folder** instead need the optional `downloads` permission that 0.4.0 added:
- Each backup shows Chrome's download bubble. Hiding it needs `downloads.ui`, which hides the download bubble for every download in the profile, so it isn't proposed.
- With Chrome's "Ask where to save each file" on, every backup opens a Save dialog.

**Settings sync through Chrome Sync** (`chrome.storage.sync`, part of the existing `storage` permission):
- Sync works only between copies of Link Meteor with the same extension ID, for people signed in to Chrome with the Extensions sync option on.
- A Developer-mode copy's ID comes from its folder's path. So **for Developer-mode installs, settings sync only between computers that load Link Meteor from exactly the same folder path**.
- A fixed `key` in the manifest would give every copy the same ID. But a test copy loaded beside the everyday one would then replace it, and it's unconfirmed whether the Chrome Web Store keeps such a key. Store installs share one ID, so sync works for them.
- Limits: 100 KB in all, 8 KB per item, 120 writes a minute.
- When a second computer first syncs, Chrome replaces that computer's synced settings with the account's.
- Settings would travel through Google's Chrome Sync. Collections never would.

**Frames from other sites and closed components** (recommended for 0.6.0):
- `chrome.dom.openOrClosedShadowRoot` works in the page script with no permission.
- `scripting.executeScript` with `allFrames` reaches every frame Link Meteor has access to, and silently skips the rest.
- Listing every frame, to say which were skipped, would need `webNavigation`, which Chrome describes as "Read your browsing history". The plan avoids it: frames that didn't answer are reported as a count.

## Added in 0.5.0 release candidate 2

After the owner's hands-on check of release candidate 1. It adds no permission and no network access.

### The citation a link uses (`src/core/identifiers.js`)

- `citationFor(link, pages?, ids?)` returns `{key, citation, reason}` or `null`:
  - `reason: 'own'`: the link's own page, `pages[url without #fragment]`;
  - otherwise a saved page about the same work, in this order: `'pdf'` (its `pdfUrl`, from `citation_pdf_url`, is the link's address without its fragment), `'doi'` (the same DOI, ignoring case) and `'arxiv'` (the same arXiv ID, ignoring the version).
- A page's DOI and arXiv ID come from its tags, or from its own address (a saved `arxiv.org/abs/…` tab without tags still matches). When several pages match, the newest `readAt` wins. The index is built once per `pages` object.
- `identifiersOf`, every citation format, `citeFacts`, the export columns, Insights and a link's details all use it.
- **Backups** keep a page citation when a link uses it this way, besides the link's own address and source page.
- **In a link's details**, a *Citation* block shows the citation the link uses when that isn't its source page's. Its note says where it came from, for example "From the citation tags of “SplatFields: …”, which names this link as its PDF. Citation exports use it."
- `arxivDate(id)` returns `[year, month]` from an arXiv ID's first four digits, the year and month of first submission: `2409.11211` gives `[2024, 9]`, `hep-th/9901001` gives `[1999, 1]` (old-style years 91 to 99 are 1990s). Otherwise `[]`.

### Citation formats

- An arXiv preprint is an entry with an arXiv ID and no journal:
  - BibTeX: `@misc` with `howpublished = {arXiv preprint arXiv:<id>}`, besides `eprint` and `archivePrefix`;
  - RIS: `TY  - UNPB`, `PB  - arXiv` and `AN  - arXiv:<id>`;
  - CSL-JSON: `type: "article"`, `publisher: "arXiv"`, `number: "arXiv:<id>"`, and no `container-title`;
  - the annotated bibliography: `arXiv preprint arXiv:<id>.` after the title;
  - the Obsidian note: a `Preprint:: arXiv:<id>` field.
- **BibTeX titles** brace each word with a capital after its first character. A word is letters and digits, joined by `-`, `'` or `’`.
- **RIS** writes the ISBN as `SN`.

### Moving and copying links

**The model** (`src/core/model.js`, pure):
- `transferLinks(state, {fromCollectionId, ids, mode: 'move' | 'copy', toCollectionId? | newCollection?}, {newId?})` returns `{state, record, moved, skipped, fields, name}`.
  - It moves or copies the chosen links, in their order, to the end of an existing collection or a new one (named with collapsed spaces, at most `MAX_COLLECTION_NAME`, 120).
  - A new collection is not opened: the open collection stays open.
  - Everything travels: notes, tags, context, status, star, capture details, `imported`, and custom column values. A value goes to the destination's column of the same name (ignoring case), or to a column created there. When the destination has no room, it refuses and nothing changes.
  - The page citations the links use (own address, source page, borrowed) are copied where the destination has none for that page.
  - A link whose address the destination already holds is skipped and stays where it is. When every chosen link is already there, it refuses.
  - A move keeps each link's id; a copy gives new ids (`newId`).
  - An earlier removal's Undo snapshot is kept.
  - `record` is `{mode, fromCollectionId, toCollectionId, createdCollection, fields, ids, positions, fieldMap, pages}`: the created column ids, the ids the destination received, a move's original positions, the column mapping, and the page citations it added.
- `revertTransfer(state, record)` removes the received links and what the transfer created, and for a move puts each link back at its old position with its values in the source's columns.
  - It removes: the new collection, or the created columns and the added page citations that no remaining link uses.
  - It refuses when a received link is gone, the new collection has other content, or other links have values in the created columns.

**Messages** (workbench only, `src/background/transfer.js`):
- `links.transfer {fromCollectionId, ids, mode, toCollectionId? | newCollection?}` saves `transferLinks` in one write and returns `{state, transferId, mode, moved, skipped, fields, collectionId, name, createdCollection}`. A failed write changes nothing.
- `links.transferUndo {transferId}` checks that the received links are exactly as the transfer wrote them (a SHA-256 fingerprint of their canonical JSON), then saves `revertTransfer`. It returns `{state, mode, count, collectionRemoved, fieldsRemoved}`, and refuses with what to do instead.
- Session key `linkMeteorTransfers`: the last 10 transfers' records with `transferId`, `digest` and `createdAt`. It lives until the browser closes.

**The workbench** (`src/ui/workbench/move.js`):
- `#move-selected` "Move to…" and `#copy-selected` "Copy to…" show in the list toolbar while links in the view are selected.
- In each link's details, `.occurrence-move` holds "Move to…", named "Move <label> to another collection".
- `#move-panel` (a form) holds:
  - `#move-title` ("Move 3 selected links to another collection", or "Move “label” to another collection");
  - `#move-to`: every other collection with its link count, then "New collection…";
  - `#move-new-row` / `#move-new`, shown for a new collection;
  - `#move-help`, which says beforehand how many links go, how many are already there and stay, and which columns it adds, or what is missing;
  - `#move-apply` ("Move 2 links", disabled while something is missing) and `#move-cancel`.
- Escape or Cancel closes the panel and returns focus to the button that opened it. The panel closes when the links it names are gone.
- A move clears the moved links from the selection. The notice says, for example, "Moved 2 links to “Thesis”. 1 link was already there and stayed here. Added 1 column there." Its Undo sends `links.transferUndo`.

### Closing the side panel from the toolbar

- On each toolbar click, the background opens the side panel in that window, as before, then sends `{type: 'panel.toggle', windowId}` to Link Meteor's pages.
- A side panel already open in that window closes: with `chrome.sidePanel.close({windowId})` where Chrome has it (Chrome 151 does), otherwise, or when that fails, with `window.close()`.
- The full view in a tab ignores the message (`chrome.tabs.getCurrent()` finds its tab). A panel opened by this click isn't listening yet, so it stays open.

### The last backup

- `backup.made {}` records when the workbench handed a backup file to Chrome's download: local key `linkMeteorLastBackup`, `{at: ISO time}`. It records nothing about the file, and Chrome doesn't report whether the person kept it.
- `backup.status` now returns `{undo, lastBackup}`; `lastBackup` is that time, or `null`.
- In Backup and restore:
  - `#backup-remove-note` says "Removing Link Meteor from Chrome deletes everything it saved. A backup file keeps it.";
  - `#backup-last` says "Last backup: never" or "Last backup: <local date and time>", with the exact time as its title.
- Chrome's own "Remove Link Meteor?" dialog can't be changed by an extension. `chrome.runtime.setUninstallURL` would open a website after removal, when the data is already gone, so it isn't used.

### PDFs and files on the computer

- `inject(tab)`, used for capturing a page or a region, refuses before injecting:
  - for a tab whose address ends in `.pdf`: "Link Meteor can’t read the links inside a PDF yet. To save one link, right-click it and choose Link Meteor, then Add link.";
  - for a `file:` page: "Link Meteor can’t capture from files on your computer. …", with the same advice.
- For other web pages, it first reads `document.contentType` (a named function, `documentType`) and refuses a PDF the same way. Chrome's PDF viewer shows a PDF, and no extension can read that.
- *Capture this page* and the capture report use the same words, in place of "Choose an ordinary HTTP or HTTPS webpage".
- Reading the links inside PDFs is planned for 0.6.0.
- The right-click menu is not gated this way: see release candidate 3 below.

### The Star button

The Star toggle in a link's details keeps the label "Star". `aria-pressed` and the pressed look say whether it's starred, so screen readers don't announce the state twice. The selection's Star or Unstar button is unchanged.

## Added in 0.5.0 release candidate 3

After the owner's hands-on check of release candidate 2. It adds no permission and no network access.

### The right-click menu on PDFs and files

Release candidate 2's capture gate also stopped *Add link* on PDFs, which had worked before. Now:
- The menus load the page script with `injectScript(tab)`, which has no PDF or file gate. In a PDF's tab the script can show a notice, though it can read no links. `inject(tab)` keeps the gate for *Select a region*, *Capture this page* and the shortcut.
- *Add link* and *Copy link text + URL*: when the page can't be asked at all (no script can load there), the link is kept with the address Chrome gave, as when the page can't find it.
  - Add link then saves it and opens the full view at it, since the page can't show the notice.
  - Copy link reports that the page couldn't copy.
- A link saved from a local file has that file's address as its source page, where Chrome shows it to Link Meteor.

### The full view and the side panel

- The side panel's `#open-full` is a labeled button, "Full view" (`aria-label` "Open the full view in a tab"). It stays hidden in the full view itself.
- In a panel narrower than 480 px, the header's buttons take their own row under the collection's name.
- Clicking it opens the full view (`ui.open`), then closes the side panel it is in (`closeIfSidePanel()` in `src/ui/workbench/panel.js`).
- *Open the full view* in the toolbar icon's menu opens it, then sends `{type: 'panel.close', windowId}`. The side panel in that window closes, as for `panel.toggle`.

### Papers with no authors yet

For BibTeX, RIS, CSL-JSON and the annotated bibliography, `#cite-facts` gains a line when `unauthored` is above zero: "2 with a DOI or arXiv ID but no authors yet. Capture from the paper’s own page (on arXiv, its abstract page) or save that page as a tab, and its authors and date fill in". Nothing is looked up online, so authors come only from a saved page about the paper.

## Planned for 0.6.0

These contracts are for 0.6.0 "Beyond one page": the links inside PDFs, capturing more than one screen or one page, frames from other sites, closed components, the PDFs behind links as one ZIP or one combined PDF, and the first optional online feature. They are a draft, written before building; each area will gain an "as built" part. Nothing here is built yet, and 0.5.0 behaves as the sections above say.

The facts they rest on were tested first, in throwaway profiles with small diagnostic extensions: which PDF reader build runs on the oldest supported Chrome, how a PDF's file can be read from its tab or from a page of its site, whether the reader can combine PDFs, how long the toolbar's temporary access lasts, and what a lookup request carries.

### The promise, restated

Until 0.6.0 nothing leaves the browser. From 0.6.0: **nothing leaves your browser unless you turn on a feature that says exactly what it sends, and where.** 0.6.0 has one such feature, [Page details lookup](#page-details-lookup), off by default. Link Meteor's own pages keep `connect-src 'none'`.

### The bundled PDF reader

- **What:** Mozilla's PDF.js, package `pdfjs-dist` 6.3.289, its legacy build, two files, unmodified: `src/vendor/pdfjs/pdf.min.mjs` (518,555 bytes) and `src/vendor/pdfjs/pdf.worker.min.mjs` (1,317,034 bytes), with its `LICENSE` (Apache-2.0) and a `README.md` naming the version, the source and each file's SHA-256. It is committed like any other source file; Link Meteor still has no package dependencies. About and help says "Reads PDFs with PDF.js by Mozilla (Apache License 2.0)".
- **Updating it** is a maintainer's step: `scripts/vendor-pdfjs.mjs <version>` fetches that exact package from the npm registry, checks the registry's integrity value, and copies the two files and the license. No test and no build step contacts the network. A unit test checks the committed files against the recorded hashes.
- **Chrome 116 to 123** lack two things the reader uses. `src/ui/workbench/pdf-shims.js` supplies them, only where missing: `Promise.withResolvers`, and async iteration of `ReadableStream`. Two wrapper modules load the shims before the reader, in the page and in its worker. With them, the same build reads PDFs on Chrome 116.
- **Where it runs:** only in Link Meteor's own pages (the side panel and the full view), and only once a PDF is read: the reader is loaded with `import()` at that moment, and its worker is a module worker from the bundled file. It never runs in the background worker or in a web page, and it is not web-accessible.
- **How it is called:** `getDocument({data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, enableXfa: false})`. Link Meteor reads annotations, text and metadata, and combines PDFs with `extractPages` (see [PDF files](#pdf-files-one-zip-or-one-combined-pdf)); it never draws a page. The character maps, standard fonts and image decoders are not bundled. In the few PDFs whose fonts need those character maps, a link's words can come out empty; its address and page number are still read.
- **Limits (`src/core/pdf.js`):** `MAX_PDF_BYTES` 50 MB, `MAX_PDF_PAGES` 2,000, and the existing `MAX_IMPORT_LINKS` (20,000). A file over a limit is refused with the reason, before reading or as soon as the page count is known.

### Reading a PDF's file

**From a web PDF's tab.** The workbench runs one function in the tab's top frame with `chrome.scripting.executeScript`, under the access rules *Capture this page* already has: the toolbar's temporary access, the site's access, or all sites; when none is there, the same click asks for the site, as today.
- The function requests the tab's own address, `fetch(location.href, {cache: 'force-cache'})`, checks that the answer starts with `%PDF-` within its first 1,024 bytes, and returns `{ok, size, type, base64}` or `{ok: false, reason}`. It leaves nothing in the page.
- That request is made as the page itself. Chrome answers from its cache when it can; otherwise the site is asked again, with that site's cookies, exactly as reloading the tab would. Nothing goes to any other address.
- Refusals, each in plain words: the answer wasn't a PDF (a sign-in page, an expired address); over `MAX_PDF_BYTES`; the request failed. Each ends with "Download the PDF, then choose Import links, PDF file."

**From a PDF file.** *Import links* accepts `.pdf` in its file chooser, and a PDF dropped on the Import links panel or on the list. The file is read in the browser and never uploaded. This needs no access of any kind.

**A PDF opened from the computer (`file:`).** Chrome doesn't let a script in that tab read the file, with or without "Allow access to file URLs", and Link Meteor's own pages can read a file address only with a permission for every file address, that browser setting, and a looser page policy. Link Meteor asks for none of them. In that tab the Capture section says "This PDF is a file on your computer. Chrome doesn’t let Link Meteor read it from the tab. Choose the file instead." with a *Choose this PDF…* button that opens the file chooser.

**Messages.** None are new for reading: the workbench reads the tab itself, and saving uses `import.commit`, which gains `pages` (below).

### What is read from a PDF (`src/core/pdf.js`, pure)

`src/core/pdf.js` imports nothing from the reader. The workbench hands it plain data, so it is unit-tested with and without real PDFs.

- `pdfLinks(pages)` takes `[{number, annotations, items}]` (each page's link annotations and text items, as the reader returns them) and returns `{links, internal, skipped}`:
  - **A link** is an annotation of subtype `Link` with an address. Its `url` is the reader's checked address, validated again by the model's own rules (web, email and phone addresses); `originalHref` is the address as written in the PDF.
  - **Its page** is the page the annotation is on: `pdfPage`, counting from 1.
  - **Its words** (`anchorText`) are the characters of that page's text items whose centers fall inside the annotation's rectangle, for items at least half inside it vertically. Rotated text is not link text. A link over a picture has empty anchor text, and stays empty.
  - **Spacing:** items are joined with a space only where there is a gap between them, so an address typeset letter by letter reads as one word.
  - **A wrapped link** is two or more annotations in a row with the same address, on one page or across a page break. They become one link, on its first page, with the words joined; when the joined words without spaces are the address or its end, they are joined without spaces.
  - The same address elsewhere in the PDF is another occurrence, kept, as on web pages.
  - `internal` counts links to places inside the PDF, which have no address. `skipped` lists `{page, reason}` for links that aren't web, email or phone addresses (another file, a script, an attachment).
- `pdfCitation({info, xmp, firstPage, links, address})` returns a `PageCitation` or `null`:
  - `arxiv`, `arxivVersion`, `arxivCategory` and `date` from arXiv's stamp on the first page, read exactly (`arXiv:2409.11211v1 [cs.CV] 17 Sep 2024`);
  - `doi` from the PDF's metadata; otherwise from the first page's text or links, and only when the first page names exactly one DOI;
  - `title` from the metadata when it isn't a file name (no extension such as `.indd`, `.tex` or `.dvi`, and not "untitled"); otherwise the largest text in the upper part of the first page;
  - `authors` from the metadata only when each name is also printed on the first page; otherwise none. PDFs rarely name their authors reliably, which is what the lookup is for;
  - `journal` and a publication `date` from the metadata's PRISM and Dublin Core fields when present. The file's creation date is never used as a publication date;
  - `pdfUrl`, the PDF's own address when it has one; and `source: 'pdf'`.
- `pdfContext(items, link)`: with *Save the words around each link* on, the words on the line or lines the link sits on, at most `MAX_CONTEXT` characters. In a reference list that is the reference.

### Link and collection data

New optional fields; absent means none, so a 0.5.0 state needs no migration.

| Field | Where | Type and limits | Meaning |
| --- | --- | --- | --- |
| `pdfPage` | link | integer, 1 to `MAX_PDF_PAGES` | The page of the PDF the link is on. Absent for links from web pages. |
| `arxivVersion` | page citation | string, at most 8 characters (`v1`) | The version on arXiv's stamp. |
| `arxivCategory` | page citation | string, at most 40 characters (`cs.CV`) | The primary category on arXiv's stamp. |
| `source` | page citation | `'pdf'`, `'crossref'`, `'datacite'` or `'pubmed'` | Where the citation was read. Absent means the page's own citation tags, as in 0.5.0. |

- **Links from a PDF in a tab** have `sourceUrl` the PDF's address, `sourceTitle` its title, `pdfPage`, and the PDF's citation as their source citation, `pages[sourceUrl]`.
- **Links from a PDF file** have empty `sourceUrl`, and `imported` such as `paper.pdf, page 3`. Rows and details show *Imported*.
- **The PDF itself as a link:** the preview's *Also save this PDF as a link* adds one link whose address is the PDF's (for a file: its arXiv abstract page or its DOI address, when the PDF names one; otherwise the choice isn't offered) and whose own citation is the PDF's.
- `import.commit` accepts `pages: {[pageUrl]: PageCitation}` beside `links`, as `links.append` does.
- A citation read from a page's own tags is never replaced by one read from a PDF; a PDF's citation fills only the fields the page didn't give.
- **Backup format 4.** `BACKUP_FORMAT_VERSION` becomes 4, so 0.5.0 refuses a 0.6.0 backup with its update message instead of dropping fields. `readBackup` accepts formats 1 to 4.
- **Exports** gain a `PDF page` column beside the capture details in CSV, TSV, the workbook and JSON. Citation formats use the PDF's citation like any other page citation.
- **A link's details** show "Page 3 of the PDF" beside its source, and the *Cited from* note says "Read from the PDF itself" for `source: 'pdf'`.

### Settings: additive schema-v1 fields

| Field | Type and default | Meaning |
| --- | --- | --- |
| `followPages` | integer 2 to 20, `20` | The most pages one Follow Next run reads. |
| `lookupDetails` | boolean, `false` | Page details lookup is on. Off, Link Meteor requests nothing from any service. |

### The PDF preview in the workbench

A PDF's links are shown before anything is saved, in the Import links view (`#import`), from a tab or from a file alike.

- **Capture section:** while the active tab is a web PDF, `#capture-label` reads "Capture this PDF" and `#scope-preview` says "A PDF. Link Meteor reads the links inside it." *Select a region* is disabled there with "Regions can’t be drawn on a PDF." The shortcut shows the same words on the page.
- `#import-source`: the PDF's title, its page count, and "from this tab (arxiv.org)" or "from a file".
- `#pdf-facts`: what the PDF says about itself, each with where it was read: "arXiv:2409.11211v1 · cs.CV · 17 Sep 2024, from the stamp on page 1", "DOI 10.1371/…, from page 1", "Title from the first page’s largest text", "No authors: PDFs rarely name them reliably."
- `#import-table`: one row per link with its page (`p. 3`), its words and its address. Links left out are listed with their reason when *Show only skipped rows* is on.
- `#import-summary`: "18 links on 9 of 15 pages", then what was left out: links to places inside the PDF, repeats, links already saved, and addresses that aren't web, email or phone addresses.
- `#import-destination`, *Skip links already saved there*, and `#pdf-self` (*Also save this PDF as a link*).
- `#import-commit` ("Add 18 links") saves one batch with `import.commit`. The notice has Undo (`import.undo`).
- **Nothing to add,** each in plain words: a PDF with no links ("This PDF has no links Link Meteor can read. Scanned pages are pictures, and addresses printed without a link aren’t picked up."); a PDF that needs a password ("Link Meteor doesn’t ask for passwords."); a damaged file; a file over a limit.
- While reading, `#import-progress` says "Reading page 12 of 244…" with Cancel.

### Runs: auto-scroll, Follow Next and selected pages

A **run** is a capture that takes more than one step. Every run:
- starts only from a click;
- shows a counter and **Stop** the whole time, on the page it is reading and in the workbench; Escape on that page stops it too;
- has a firm cap, stated before it starts;
- saves what it found as one batch with one Undo, and keeps what it has when stopped;
- ends with a report: each page with what was found, what was added and how it ended.

**Auto-scroll** (*Scroll to the end first*, a check box under *Capture this page*):
- The page script scrolls the page one screen at a time (90% of the window's height), collecting links after each step, so links a page later removes are kept.
- It waits for the page to settle after each step: 600 ms, and up to 2 seconds more while the page is still growing.
- It ends when the page's height and link count haven't changed for three steps in a row ("Reached the end"), or at a cap: 50 screens, 5,000 links or 2 minutes ("Stopped at 50 screens. The page may have more.").
- It then scrolls back to where the person was.
- Counter: "Scrolling: screen 9 of up to 50 · 412 links".
- It needs no access beyond what capturing that page needs.

**Follow Next** (*Follow Next, up to N pages*, a check box under *Capture this page*; N is `followPages`):
- After capturing a page, the page script looks for the next page, in this order: `<link rel="next">` or `<a rel="next">`; a link labeled next by `aria-label` or its text ("Next", "Next page", "Older", "›", "»", "→", and the like, listed in the code); otherwise none. A next address must be a web address not yet read in this run.
- The background moves **the same tab** to it, waits for the page to load (at most 30 seconds), pauses 1.5 seconds, and captures it. The person sees every page it reads.
- The toolbar's temporary access lasts while the tab stays on the same site, so one toolbar click is enough there. Where Link Meteor has the sites' access, Next may cross sites.
- It ends, each said in the report: no next page; the next page is on a site Link Meteor can't read ("Next goes to example.org, which Link Meteor has no access to."); a page already read (a loop); a page that didn't load; the cap; Stop; the tab closed or moved by the person.
- Counter: "Page 4 of up to 20 · 212 links".
- With *Scroll to the end first* also on, each page is scrolled first.

**Capture selected pages** (*Capture their pages…* in the list toolbar while links are selected, and in a link's details):
- `#pages-panel` says beforehand: how many pages; that each opens in a background tab, one at a time, is captured and closed; the cap of 20 pages a run; the 2-second pause; which sites it needs, with *Allow these N sites* where access is missing; and where the links go.
- More than 20 selected pages are refused with "Choose up to 20 pages at a time."
- Each page: `chrome.tabs.create({url, active: false})`, wait for it to load (at most 30 seconds), capture the whole page, close the tab, pause.
- A page that is a PDF is read as a PDF (above). A page Link Meteor has no access to is not opened, and is reported as "No access". A page that redirects to a site without access is closed and reported the same way.
- It goes one level deep, never further: links found are saved, not followed.
- Counter: "Page 3 of 12 · 148 links".

**Messages** (`src/background/runs.js`):
- `run.start {kind: 'next' | 'pages' | 'files', tabId?, urls?, collectionId, scroll: boolean}` returns `{runId}`, or a refusal; `files` is the kind [PDF files](#pdf-files-one-zip-or-one-combined-pdf) uses, and saves no links;
- `run.stop {runId}`;
- `run.status {}` returns the run in progress, for a workbench opened meanwhile;
- `run.progress {runId, kind, step, of, links, state}` is sent to Link Meteor's pages as the run moves;
- `run.undo {collectionId, batchId}` removes the run's batch, as `import.undo` does.

Auto-scroll alone is one page and uses `capture.run` with `scroll: true`.

**Storage:** session key `linkMeteorRun`: the run in progress (its kind, queue, counts and batch), so a restarted background worker either continues it or reports it as interrupted. It holds no page content, and lives until the browser closes. Only one run at a time.

### PDF files: one ZIP, or one combined PDF

In the Export panel's *Download files*, the PDFs among the chosen links (the file links `src/core/files.js` types as `pdf`) get two more actions. *Download files* itself is unchanged: it still saves every file one by one through Chrome's downloads.

**Getting each PDF's file.** A page of the PDF's own site requests it, `fetch(url, {credentials: 'include'})`, as when the link is clicked, with that site's cookies. Which page:
1. the active tab, when it is on the PDF's site and Link Meteor can run there (the toolbar's temporary access is enough);
2. otherwise a background tab, opened at the page the link was captured from when that page is on the PDF's site, else at the site's front page, and closed afterward;
3. when the address redirects to another site, a background tab opened at the PDF's own address, read there as [a PDF in a tab](#reading-a-pdfs-file) once Chrome shows it.

- Background tabs need access to those sites, asked for by name in the click, as *Capture selected pages* does. Files on sites without access are reported as "No access" and left out.
- Chrome saves a PDF to the Downloads folder by itself when a tab is opened at an address the site sends as a download. Steps 1 and 2 avoid that. When step 3 meets one, the report says "Chrome downloaded this one instead of showing it. It is in your Downloads folder, not in this file."
- Every answer must start with `%PDF-` within its first 1,024 bytes; a sign-in page is reported as "Not a PDF: the site asked to sign in, or the address has expired."
- It is a run of kind `files`: one file at a time, 2 seconds apart, a counter with Stop ("Getting PDF 3 of 5"), and a report of each file with how it ended.
- **Limits (`src/core/pdf.js`):** `MAX_PDF_SET` 20 PDFs a run; `MAX_PDF_BYTES` 50 MB each; `MAX_PDF_SET_BYTES` 200 MB in all. More than 20 are refused with "Choose up to 20 PDFs at a time."
- The files are held in the workbench's memory until the download is made, and nowhere else.

**Download as one ZIP** (`#pdf-zip`):
- `src/core/zip.js` (pure) holds the ZIP writer the workbook writer has used since 0.3.0 (`zip(files)` and `crc32`, moved from `src/core/xlsx.js`, which imports it). Entries are stored, not compressed: PDFs are compressed already, and each file's bytes stay exactly what the site sent.
- Entry names come from `downloadName` in `src/core/files.js`, as *Download files* names them; repeats get ` (2)`, ` (3)`.
- The ZIP is named like an export, `<collection>_<date>_<time>.zip`, and is handed to Chrome's download as exports are. It holds no index and nothing but the PDFs.

**Combine into one PDF…** (`#pdf-combine`, opening `#combine-panel`):
- `#combine-list`: the PDFs in the order of the list, each with its file name, its link's anchor text, its page count and size once read, and buttons to move it up or down or leave it out (the same controls as *Columns, in order*, with the same labels and focus handling).
- *Add PDF files…* and dropping files on the list add PDFs from the computer, read in the browser; they count toward the limits. With no links chosen, the panel still combines files from the computer.
- `#combine-name`: the file name, by the export name pattern, ending `.pdf`.
- The summary says the number of PDFs, pages and megabytes, and lists what is left out with the reason: needs a password, damaged, not a PDF, no access, over a limit.
- `#combine-apply` ("Combine 5 PDFs") gets the files still missing, then writes one PDF with the reader's `extractPages([{document: null}, {document: bytes}, …])` on the first PDF, in the list's order, and hands it to Chrome's download.
- **What the combined PDF keeps** (tested): every page, its text, its web links, the links inside each document, and each document's bookmarks. **Not kept:** page labels (such as i, ii, iii), form fields' behavior and document-level attachments are not promised. A PDF that needs a password can't be combined, and goes into a ZIP as it is.
- Whole PDFs only: choosing single pages is not in 0.6.0.

### Frames from other sites, and closed components

- **Frames.** *Capture this page* runs the collector in every frame Link Meteor has access to (`allFrames`), and each frame's links keep their `frameUrl`. With only the toolbar's temporary access, frames from other sites can't be read; the report names their sites, from the frames' addresses in the page, and offers *Allow these sites* to include them. Frames whose sites can't be named are reported as a count. No `webNavigation` permission is used.
- **Closed components.** The collector looks inside closed shadow roots with `chrome.dom.openOrClosedShadowRoot`, which needs no permission. Region selection includes their links too.

### Page details lookup

Off by default (`lookupDetails`). It fills in a paper's title, authors, date and journal from its identifier.

- **When it runs:** only on a click: *Look up details* for the selected links, in a link's details, or beside the Export panel's "no authors yet" line. Never by itself, never in the background, and never for links without a DOI, an arXiv ID or a PubMed ID.
- **Where the request is made:** a sandboxed frame, `ui/lookup-frame.html`, created when a lookup starts and removed when it ends. Its origin is `null`; it has no access to collections, storage or Chrome's APIs. The workbench hands it one identifier at a time and receives the service's answer. Its policy is `sandbox allow-scripts; default-src 'none'; script-src 'self'; connect-src https://api.crossref.org https://api.datacite.org https://eutils.ncbi.nlm.nih.gov`. Link Meteor's own pages keep `connect-src 'none'`.
- **What is sent, and where:**

  | Identifier | Request | Service |
  | --- | --- | --- |
  | A DOI | `GET https://api.crossref.org/works/<DOI>` | Crossref |
  | A DOI Crossref doesn't have, or an arXiv ID as `10.48550/arXiv.<ID>` | `GET https://api.datacite.org/dois/<DOI>` | DataCite |
  | A PubMed ID | `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<ID>&retmode=json` | NCBI (the US National Library of Medicine) |

  Each request carries that one identifier and nothing else of the person's: no page address, no link text, no collection name, no notes. It is sent with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`: no cookies are sent or kept, and there is no referrer. Its `Origin` is `null`, so it doesn't carry Link Meteor's ID. Like any request, it shows the service the person's IP address, and the browser's version and language list.
- **Pace and limits:** one request at a time, at least 350 ms apart; at most 200 identifiers a run; a counter with Stop ("Looking up 7 of 31"). A service that answers "too many requests" ends the run with what it has.
- **What comes back** (`src/core/lookup.js`, pure): each service's answer mapped to a `PageCitation` with `source: 'crossref'`, `'datacite'` or `'pubmed'` and `readAt`. Text is treated as untrusted: tags are removed, lengths are capped as for every page citation.
- **Where it goes:** the link's own citation, `pages[link.url]`. A lookup fills only fields that are empty; it never replaces what a page's own tags or the person gave. The notice says what changed ("Filled in authors for 6 papers, dates for 2. 1 wasn’t found.") and has Undo.
- **Turning it on:** *Online lookups* in the workbench's settings shows the explanation below and a switch. The first *Look up details* click with the switch off opens that explanation instead of sending anything.

### Permissions, browser settings and network requests

**0.6.0 adds no permission to the manifest, asks for no browser setting, and adds one optional online feature.**

| What | New? | Reason shown |
| --- | --- | --- |
| Manifest permissions | None new | |
| Optional site access (`http://*/*`, `https://*/*`, from 0.3.0) | Three new uses | *Capture selected pages* reads pages in background tabs, whole-page capture can include frames from other sites, and *Download as one ZIP* and *Combine into one PDF* get PDFs through a page of their site. Each asks only for the sites it names, in the click, or uses all-sites access where it was already given. |
| `chrome.dom.openOrClosedShadowRoot` | New use, no permission | Reads links inside closed components. |
| A sandboxed page in the manifest (`sandbox.pages`, `content_security_policy.sandbox`) | New | The only place a lookup request can be made. |
| `content_security_policy.extension_pages` | Unchanged | `connect-src 'none'` stays. |
| "Allow access to file URLs" | Not asked for | It doesn't make a local PDF readable. The file chooser needs no access. |
| "Allow in Incognito" | Not asked for | `incognito` stays `not_allowed`. |
| A PDF's file, requested again from its own address | New request | See below. |
| Pages loaded by Follow Next and by *Capture selected pages* | New requests | See below. |
| PDF files requested for a ZIP or a combined PDF | New requests | See below. Saving them needs no permission: the file is handed to Chrome's download, as exports are. |
| Page details lookup | New, optional, off by default | See below. |

**The words to use.** `docs/PRIVACY.md`, `site/privacy.html` and `CHROMEWEBSTORE.md` say these in the foundation, and the workbench shows the same words where each feature starts.

- **PDFs.** "To read the links in a PDF that is open in a tab, Link Meteor asks Chrome for the file again from the same address, as that page. Chrome usually answers from its own cache; otherwise the site is asked again, as when you reload the tab. The PDF is read inside your browser by PDF.js, which is part of Link Meteor. It is never uploaded. A PDF you choose from your computer is read the same way, and Link Meteor needs no access for it."
- **Auto-scroll.** "*Scroll to the end first* scrolls the page for you, so the page loads the rest of itself as it would if you scrolled. It stops at the end, at 50 screens, at 5,000 links, after 2 minutes, or when you press Stop."
- **Follow Next.** "*Follow Next* moves your tab to the page’s own Next link and captures each page, up to the number you set (20 at most). Each page loads as it would if you clicked Next yourself. It stops when there is no Next, at a site Link Meteor can’t read, at the limit, or when you press Stop."
- **Capture selected pages.** "*Capture their pages* opens each page you chose in a background tab, one at a time, saves its links and closes the tab: 20 pages at most, with a pause between pages. Each page loads as it would if you opened it yourself, signed in as you are. Link Meteor asks first for access to the sites it will read, unless you allowed all sites. It never follows the links it finds."
- **One ZIP, or one combined PDF.** "*Download as one ZIP* and *Combine into one PDF* get each PDF you chose through a page of its own site, as when you click the link, signed in as you are: 20 PDFs at most, one at a time. Where that needs a background tab, Link Meteor asks first for access to the sites it will read, unless you allowed all sites. The files are put together inside your browser by Link Meteor and saved through Chrome's download. They are never uploaded, and Link Meteor keeps no copy."
- **Page details lookup.** "*Page details lookup* is off unless you turn it on. When it is on and you click *Look up details*, Link Meteor sends the paper’s DOI, arXiv ID or PubMed ID, and nothing else, to: Crossref (api.crossref.org) for DOIs; DataCite (api.datacite.org) for DOIs Crossref doesn’t have, including arXiv’s; and NCBI (eutils.ncbi.nlm.nih.gov) for PubMed IDs. No page address, link text, note or collection name is sent. No cookies are sent or kept. Like any website you visit, those services see your IP address and your browser’s version and language. What they return (title, authors, date, journal) is saved in this browser with the link."
- **`CHROMEWEBSTORE.md`** adds, under remote code: "Link Meteor includes PDF.js (Mozilla, Apache-2.0) as files inside the package. It loads no code from anywhere else." Under data use: the lookup's sentence above, and that it is optional and off by default.

### Later, stated now so the wording is settled

These are planned for 0.7.0 and are not built in 0.6.0.

- **Dead-link check** (optional, off by default). "When you click *Check links*, Link Meteor sends one request to each chosen link’s own site, to see whether the page still answers. Each site sees your IP address and your browser’s version, as when you visit it. No cookies are sent. Nothing is sent to anyone else." It needs all-sites access to read an answer, and `connect-src` opened to web addresses on Link Meteor's pages, which is why it is a release of its own.
- **Wayback** (optional, off by default). "When you click *Find an archived copy*, Link Meteor sends that link’s address to the Internet Archive (archive.org) and saves the archived copy’s address and date with the link. The Internet Archive sees the address and your IP address." It never asks the Archive to save a page.
- **Incognito session collections.** Needs the manifest's `incognito` key changed and Chrome's "Allow in Incognito" turned on by the person. Until then Link Meteor doesn't run in incognito windows.
