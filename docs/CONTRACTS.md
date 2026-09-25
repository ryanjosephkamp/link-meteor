# Shared implementation contracts — v1

JavaScript modules use the following exact field names and exports. Pure model/export modules do not reference Chrome, DOM, or Node-only APIs. Changes require notifying the driver before breaking a consumer.

## Data

`Link`: `{id, anchorText, accessibleLabel, url, originalHref, sourceUrl, sourceTitle, frameUrl, capturedAt, batchId, notes, tags}`. All fields except tags are strings; tags is string[]. id is stable for this occurrence. Empty anchorText is meaningful. Capture candidates have the same descriptive fields but no id/batchId/capturedAt/notes/tags; background supplies these.

`Collection`: `{id,name,notes,tags,createdAt,updatedAt,links:Link[]}`.

`State`: `{schemaVersion:1,activeCollectionId,collections:Collection[],settings:{holdKey:'z',holdOrigins:string[]},undo:null|{collectionId,links:Link[],indices:number[]}}`.

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
- `state.mutate`, `{action}` => State, after successful storage write.
- `tabs.list` => `{tabs:[{id,windowId,title,url,active}],currentWindowId,targetTabId}`. UI asks optional `tabs` permission before multi-tab inventory.
- `capture.run`, `{tabIds:number[]}` => `{state,report:CaptureReport}`. Empty tabIds means current page. UI requests optional origins for explicit multi-tab choices before calling; background never prompts.
- `capture.arm`, `{tabId?:number}` => `{tabId}`. Uses activeTab or granted host permission; forbidden pages return error.
- `capture.commit`, `{links:Candidate[],inaccessibleFrames?:number,review?:boolean}` => `{state,count,warning}`; a Review-open failure returns a successful save plus warning. Only accept from a content-script sender with a tab. review opens full workbench.
- `ui.open` => `{}`; opens full extension workbench tab.
- `links.open`, `{urls:string[]}` => `{opened:number,failed:number}`. HTTP(S) only; maximum 20 per request, reject larger input explicitly.
- `links.bookmark`, `{name:string,links:[{anchorText,url}]}` => `{folderId,count,failed}`. UI requests optional bookmarks permission before calling.
- `hold.configure`, `{origin:string,enabled:boolean,key:string}` => State. UI requests that exact origin first when enabling. Background registers/unregisters host-scoped content script and persists settings.

State updates also emit `chrome.runtime.sendMessage({type:'state.changed'})`; UI reloads state and may also watch chrome.storage.onChanged for `linkMeteorState` to recover missed notifications. Do not treat these notifications as user requests.

UI source scope `current`, `selected`, `window`, `all` is resolved by UI from tabs.list/currentWindowId; extension/internal tabs are visibly unsupported in capture results rather than scanned. Tab list includes ordinary windows only. Origin grants use `origin + '/*'` for HTTP(S).

Content capture script installs `globalThis.__linkMeteor = {scan,arm}` in its isolated world, once per document. `scan()` returns the capture result synchronously. `arm()` installs selection UI. Background injects `content/capture.js` and invokes these methods with scripting.executeScript. It accepts `content.configure` messages `{holdKey,enabled}` for immediate hold-mode settings; dynamically registered scripts can obtain settings via `state.get`. All content-created UI is marked and excluded from extraction.

Latest capture reports are retained at session key `linkMeteorCaptureReport` as `{report,createdAt}`. The UI freezes the originally selected tab IDs before a host-permission request; survivors are checked for origin drift, closed IDs remain for explicit error results, and newly opened tabs are excluded from that capture.
