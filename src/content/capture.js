(() => {
  if (globalThis.__linkMeteor?.alive?.()) return;
  globalThis.__linkMeteor?.dispose?.();
  const listeners = [];
  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push({target, type, listener, options});
  }
  function unlisten(target, type, listener, options) {
    target.removeEventListener(type, listener, options);
    const index = listeners.findIndex(item => item.target === target && item.type === type && item.listener === listener);
    if (index !== -1) listeners.splice(index, 1);
  }
  function alive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  function dispose() {
    active?.close();
    for (const {target, type, listener, options} of listeners.splice(0)) target.removeEventListener(type, listener, options);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* extension reloaded */ }
    held=false;holdEnabled=false;pressStart=null;fileNoticeHost?.remove();
  }
  const MAX_LINKS = 20000;
  // The card lists at most this many links for unticking; the rest stay included.
  const PREVIEW_LIMIT = 1000;
  // Opening rules shared with the full view: no confirmation up to 20, stronger wording above 100.
  const OPEN_LIMIT = 500, CONFIRM_ABOVE = 20, STRONG_ABOVE = 100;
  // A modifier press becomes a selection only after the pointer moves this far (CSS pixels).
  const DRAG_THRESHOLD = 6;
  // The notice after copying or adding right away closes itself after this long, unless it has focus.
  const NOTICE_MS = 8000;
  // Page chrome: links in navigation, headers, footers and sidebars, by element or landmark role.
  const PAGE_CHROME = 'nav,aside,[role~="navigation"],[role~="banner"],[role~="contentinfo"],[role~="complementary"]';
  // A header or footer is page chrome only at page level, as HTML maps them to banner and
  // contentinfo: one inside an article, main or section belongs to that content (a post's title).
  const pageLevel = node => { const edge = node.closest('header,footer'); return !!edge && !edge.parentElement?.closest('article,main,section'); };
  const MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const marker = 'data-link-meteor';
  let active = null, held = false, holdKey = 'z', holdTrigger = 'letter', holdEnabled = false, lastDestinationId = '';
  // The card's theme ({theme, appearance, light, dark}, from settings.get or content.configure) and
  // the capture settings the card follows. Until they arrive, the card keeps its built-in look.
  let cardTheme = null, captureSettings = {afterDrag: 'card', afterDragFormat: 'tsv', contentOnly: false, skipSaved: false}, overlayHost = null;
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');
  const cardScheme = () => cardTheme?.appearance === 'light' || cardTheme?.appearance === 'dark' ? cardTheme.appearance : (darkScheme.matches ? 'dark' : 'light');
  // Sets the theme's custom properties on the card's host, where the page's own styles can't reach.
  function themeHost(host) {
    if (!host || !cardTheme) return;
    for (const [name, value] of Object.entries(cardTheme[cardScheme()] || {})) host.style.setProperty(name, value, name === 'color-scheme' ? 'important' : '');
  }
  function followSettings(settings) {
    if (settings?.card) cardTheme = settings.card;
    for (const key of Object.keys(captureSettings)) if (key in (settings || {})) captureSettings[key] = settings[key];
    themeHost(overlayHost);
  }
  const normalize = value => String(value || '').replace(/\s+/gu,' ').trim();
  const intersect = (a,b) => ({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
  const positive = r => r.right > r.left && r.bottom > r.top;
  const svg = body => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${body}</svg>`;
  const mark = id => `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><defs><linearGradient id="lm-${id}" x1="15.7" y1="8.3" x2="4" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--k-hl)"/><stop offset="1" style="stop-color:var(--k-hl)" stop-opacity=".2"/></linearGradient></defs><path d="M13.2 4.6 19.4 10.8 4.6 20.4Q3.6 19.4 4.6 18.4Z" fill="url(#lm-${id})"/><circle cx="16.3" cy="7.7" r="4.4" style="fill:var(--k-hl)"/></svg>`;
  const ICON_X = svg('<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>');
  const ICON_COPY = svg('<rect x="7" y="7" width="10" height="10.5" rx="1.5"/><path d="M13 7V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 3 4v8.5A1.5 1.5 0 0 0 4.5 14H7"/>');
  const ICON_PLUS = svg('<path d="M10 4.5v11M4.5 10h11"/>');
  const ICON_CHECK = svg('<path d="m4.5 10.5 3.5 3.5 7.5-8"/>');
  const ICON_LIST = svg('<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.5 5.5h.1M3.5 10h.1M3.5 14.5h.1"/>');
  const ICON_OPEN = svg('<path d="M11.5 3.5h5v5M16.5 3.5l-7 7M14.5 12v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H8"/>');
  const ICON_MORE = svg('<path d="M4.5 10h.1M10 10h.1M15.5 10h.1" stroke-width="2.6"/>');
  const ICON_REGION = svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.4 2.1"/><path d="M11 11l6.3 2.3-2.8 1.2-1.2 2.8Z" fill="currentColor"/>');

  function visible(element) {
    for (let node=element;node?.nodeType===1;node=node.parentElement || node.getRootNode()?.host) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || node.hasAttribute('hidden')) return false;
    }
    return true;
  }

  function candidate(anchor, invalid) {
    const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href');
    if (href === null || !visible(anchor)) return null;
    let url;
    try { url = new URL(href,anchor.baseURI); } catch { return null; }
    if (!['http:','https:','mailto:','tel:'].includes(url.protocol)) return null;
    if (/\s|[\u0000-\u001f\u007f]/u.test(url.href) || (url.protocol==='tel:'&&!url.pathname)) {
      invalid();return null;
    }
    const rects = [...anchor.getClientRects()].filter(positive);
    if (!rects.length) return null;
    const anchorText = normalize(typeof anchor.innerText === 'string' ? anchor.innerText : anchor.textContent);
    let accessibleLabel = normalize(anchor.getAttribute('aria-label'));
    if (!accessibleLabel && anchor.getAttribute('aria-labelledby')) accessibleLabel = normalize(anchor.getAttribute('aria-labelledby').split(/\s+/).map(id => anchor.ownerDocument.getElementById(id)?.textContent || '').join(' '));
    if (!accessibleLabel) accessibleLabel = normalize([...anchor.querySelectorAll('img[alt]')].map(img => img.alt).join(' '));
    return {anchorText,accessibleLabel,url:url.href,originalHref:href,sourceUrl:location.href,sourceTitle:document.title,frameUrl:anchor.ownerDocument.URL};
  }

  // Whether a link sits in page chrome, looking out through open shadow roots to their hosts.
  function inChrome(element) {
    for (let node=element;node;node=node.getRootNode()?.host) if (node.closest(PAGE_CHROME)||pageLevel(node)) return true;
    return false;
  }

  function geometry(anchor, transform, clip) {
    const project = rect => ({left:transform.x+rect.left*transform.sx,top:transform.y+rect.top*transform.sy,right:transform.x+rect.right*transform.sx,bottom:transform.y+rect.bottom*transform.sy});
    let visibleClip = clip;
    for (let parent=anchor.parentElement || anchor.getRootNode()?.host;parent;parent=parent.parentElement || parent.getRootNode()?.host) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      const rect = project(parent.getBoundingClientRect());
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) visibleClip = {...visibleClip,left:Math.max(visibleClip.left,rect.left),right:Math.min(visibleClip.right,rect.right)};
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) visibleClip = {...visibleClip,top:Math.max(visibleClip.top,rect.top),bottom:Math.min(visibleClip.bottom,rect.bottom)};
    }
    return [...anchor.getClientRects()].map(rect => intersect(project(rect),visibleClip)).filter(positive);
  }
  // A link's rectangles now, in the page's viewport: the same frame math as collect(), walked up
  // from the link's own frame, so highlights can stay on their links while the page scrolls.
  function rectsNow(anchor) {
    const frames=[];
    try{for(let win=anchor.ownerDocument.defaultView;win&&win!==window&&win.frameElement;win=win.parent)frames.unshift(win.frameElement);}catch{return[];}
    let transform={x:0,y:0,sx:1,sy:1},clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
    for(const element of frames){
      const frame=element.getBoundingClientRect();
      const sx=transform.sx*(element.offsetWidth?frame.width/element.offsetWidth:1),sy=transform.sy*(element.offsetHeight?frame.height/element.offsetHeight:1);
      transform={x:transform.x+(frame.left+element.clientLeft)*transform.sx,y:transform.y+(frame.top+element.clientTop)*transform.sy,sx,sy};
      clip=intersect(clip,{left:transform.x,top:transform.y,right:transform.x+element.clientWidth*sx,bottom:transform.y+element.clientHeight*sy});
    }
    return anchor.isConnected?geometry(anchor,transform,clip):[];
  }

  function collect(regional=false) {
    const records = [], warnings = [];
    let inaccessibleFrames=0, malformedLinks=0, capped=false;
    const seenDocuments = new Set();
    const viewport = {left:0,top:0,right:innerWidth,bottom:innerHeight};
    // `chrome`: the frame being walked sits in page chrome of the document around it.
    function walk(root, transform={x:0,y:0,sx:1,sy:1}, clip=viewport, chrome=false) {
      if (root.nodeType===9) { if(seenDocuments.has(root))return; seenDocuments.add(root); }
      for (const element of root.querySelectorAll('*')) {
        if (element.closest(`[${marker}]`)) continue;
        if (element.matches('a[href],a[xlink\\:href]')) {
          const link = candidate(element,()=>malformedLinks++);
          if (link) {
            const rects = regional ? geometry(element,transform,clip) : [];
            if (!regional || rects.length) {
              if (records.length===MAX_LINKS) { capped=true; continue; }
              records.push({element,link,rects,chrome:chrome||inChrome(element)});
            }
          }
        }
        if (element.shadowRoot) walk(element.shadowRoot,transform,clip,chrome);
        if (element.tagName==='IFRAME' || element.tagName==='FRAME') {
          if (!visible(element)) continue;
          try {
            const child = element.contentDocument;
            if (!child) {inaccessibleFrames++;continue;}
            const frame = element.getBoundingClientRect();
            const sx = transform.sx * (element.offsetWidth ? frame.width/element.offsetWidth : 1);
            const sy = transform.sy * (element.offsetHeight ? frame.height/element.offsetHeight : 1);
            const next = {x:transform.x+(frame.left+element.clientLeft)*transform.sx,y:transform.y+(frame.top+element.clientTop)*transform.sy,sx,sy};
            const frameClip={left:next.x,top:next.y,right:next.x+element.clientWidth*sx,bottom:next.y+element.clientHeight*sy};
            walk(child,next,intersect(clip,frameClip),chrome||inChrome(element));
          } catch { inaccessibleFrames++; }
        }
      }
    }
    walk(document);
    if (inaccessibleFrames) warnings.push(`${inaccessibleFrames} inaccessible frame${inaccessibleFrames===1?' was':'s were'} excluded. Same-origin frames and open shadow roots are supported.`);
    if (malformedLinks) warnings.push(`${malformedLinks} malformed link destination${malformedLinks===1?' was':'s were'} excluded.`);
    if (capped) warnings.push('Capture reached 20,000 loaded links. Results are partial; select smaller regions for the remainder.');
    return {records,inaccessibleFrames,warnings};
  }

  function scan() {
    const {records,inaccessibleFrames,warnings} = collect();
    // Links in page chrome carry pageChrome: true, so Capture this page can leave them out.
    return {links:records.map(record=>record.chrome?{...record.link,pageChrome:true}:record.link),inaccessibleFrames,warnings};
  }

  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'Link Meteor did not respond. Reload the extension and this page.');
    return result.data;
  }

  // Writes text, and HTML for rich links, to the clipboard: 'rich', 'plain' or '' (blocked). Without
  // the async clipboard (for example on a plain-HTTP page), it copies through a hidden text area in `root`.
  async function clip(text,html,root){
    if(html){try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);return 'rich';}catch{/* the text area below */}}
    else{try{await navigator.clipboard.writeText(text);return 'plain';}catch{/* the text area below */}}
    const area=document.createElement('textarea'),back=root.activeElement || document.activeElement;area.value=text;area.style.cssText='position:fixed;left:0;top:0;opacity:0';root.append(area);
    if(html)area.addEventListener('copy',event=>{event.preventDefault();event.clipboardData.setData('text/html',html);event.clipboardData.setData('text/plain',text);});
    area.focus();area.select();const copied=document.execCommand('copy');area.remove();back?.focus?.({preventScroll:true});
    return copied?(html?'rich':'plain'):'';
  }

  function editable(event) {
    return event.composedPath().some(node => node?.nodeType===1 && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.getAttribute('role')==='textbox'));
  }


  const plural = (n,word,many=word+'s') => `${Number(n).toLocaleString()} ${n===1?word:many}`;
  function randomId() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* not a secure context */ }
    return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  }
  // A card or selection in progress. A notice alone (after copying or adding right away) steps aside for a new drag.
  const busy = () => !!active && !active.idle();
  // Card filters: each keeps only matching links ticked. A site is the host name without a leading "www.".
  const siteOf = link => { try { const url = new URL(link.url); return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./,'') : null; } catch { return null; } };
  const FILTERS = {all:()=>true, other:link=>{const site=siteOf(link);return site!==null&&site!==location.hostname.replace(/^www\./,'');}, pdf:link=>{try{return /\.pdf$/i.test(new URL(link.url).pathname);}catch{return false;}}, same:link=>siteOf(link)===location.hostname.replace(/^www\./,'')};
  // File links, decided exactly as core/files.js decides them (tests/files.test.mjs checks this copy), and the download limits.
  const FILE_TYPES=new Set('pdf ps eps doc docx docm dot dotx xls xlsx xlsm xlt xltx ppt pptx pptm pps ppsx pot potx rtf odt ods odp odg odf ott ots otp txt md markdown csv tsv json jsonl xml yaml yml bib ris enw nbib tex ipynb epub mobi azw azw3 djvu fb2 zip gz tgz tar bz2 xz 7z rar zst png jpg jpeg gif webp svg tif tiff bmp avif heic heif ico mp3 wav m4a aac ogg oga flac opus mp4 m4v mov webm mkv avi ogv'.split(' ')),KNOWN_PDFS=[[/(^|\.)arxiv\.org$/,/^\/pdf\/./],[/(^|\.)openreview\.net$/,/^\/pdf$/,/(^|&)id=./],[/^dl\.acm\.org$/,/^\/doi\/pdf\/./],[/(^|\.)ncbi\.nlm\.nih\.gov$/,/^\/pmc\/articles\/PMC\d+\/pdf(\/|$)/i],[/^pmc\.ncbi\.nlm\.nih\.gov$/,/^\/articles\/PMC\d+\/pdf(\/|$)/i]],fileLink=link=>{let url;try{url=new URL(link.url);}catch{return false;}if(url.protocol!=='http:'&&url.protocol!=='https:')return false;const ext=(url.pathname.slice(url.pathname.lastIndexOf('/')+1).match(/\.([a-z0-9]{1,8})$/i)?.[1]||'').toLowerCase();return FILE_TYPES.has(ext)||/^\s*\[PDF\]/i.test(String(link.anchorText??''))||KNOWN_PDFS.some(([host,path,query])=>host.test(url.hostname)&&path.test(url.pathname)&&(!query||query.test(url.search.slice(1))));};
  const FILE_LIMIT = 100, FILE_CONFIRM_ABOVE = 10;
  // The copy format for After a drag, as the notice names it.
  const COPIED_AS = {tsv:'as a table', text:'as URLs', markdown:'as Markdown', rich:'as rich links'};
  // Unique HTTP(S) destinations, in order: what opening and bookmarking can use.
  function webUrls(links) {
    const urls = new Set();
    for (const link of links) { try { const url = new URL(link.url); if (url.protocol==='http:'||url.protocol==='https:') urls.add(url.href); } catch { /* not a web link */ } }
    return [...urls];
  }

  // A click that ends a hold-drag is not a click on the page: suppress that one click.
  function suppressNextClick() {
    const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); done(); };
    const release = () => setTimeout(done,0);
    function done() { unlisten(window,'click',stop,true); unlisten(window,'pointerup',release,true); unlisten(window,'pointercancel',release,true); }
    listen(window,'click',stop,true);
    listen(window,'pointerup',release,true);
    listen(window,'pointercancel',release,true);
  }

  function arm(startEvent, current, notice) {
    active?.close();
    held=false;
    const host=document.createElement('div');
    host.setAttribute(marker,'overlay');host.id='link-meteor-overlay';
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    overlayHost=host;themeHost(host);
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
      :host{color-scheme:light dark;--k-ground:#161d2d;--k-ground2:#0f1422;--k-strong:#fff;--k-ink:#eef0f4;--k-soft:#dfe3ea;--k-muted:#a2a8b5;--k-faint:#7d8394;--k-warn:#f4c26a;--k-accent:#c3f344;--k-accent-hover:#d4f86f;--k-on-accent:#161d2d;--k-link:#c3f344;--k-link-hover:#d4f86f;--k-focus:#c3f344;--k-hl:#c3f344;--k-edge:rgba(126,168,27,.95);--k-shadow-45:rgba(8,11,20,.45);--k-shadow-25:rgba(8,11,20,.25)}
      *{box-sizing:border-box}
      .shield{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none}
      .rect{position:fixed;border:1.5px solid var(--k-hl);background:color-mix(in srgb,var(--k-hl) 8%,transparent);box-shadow:0 0 0 1px rgba(22,29,45,.55),inset 0 0 0 1px rgba(22,29,45,.3);border-radius:3px;pointer-events:none}
      .hit{position:fixed;background:color-mix(in srgb,var(--k-hl) 38%,transparent);outline:1px solid var(--k-edge);box-shadow:0 0 0 1px rgba(22,29,45,.22);border-radius:3px;pointer-events:none}
      .hit.off{background:none;outline:1.5px dashed var(--k-edge);box-shadow:none}
      .badge{position:fixed;display:flex;align-items:center;gap:6px;pointer-events:none;background:var(--k-ground);color:var(--k-strong);border-radius:999px;padding:4px 10px 4px 8px;font:700 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap}
      .badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--k-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--k-accent) 22%,transparent)}
      .panel{position:fixed;pointer-events:auto;background:var(--k-ground);color:var(--k-ink);border:1px solid color-mix(in srgb,var(--k-strong) 10%,transparent);box-shadow:0 18px 50px var(--k-shadow-45),0 2px 6px var(--k-shadow-25);font:400 13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:14px;max-width:calc(100vw - 24px);-webkit-font-smoothing:antialiased}
      .hint{top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 12px}
      .hint strong{font-weight:650;color:var(--k-strong)}.hint span{color:var(--k-muted)}
      .mark{width:22px;height:22px;flex:none;display:block}
      .bar{right:16px;bottom:16px;width:400px;max-height:calc(100vh - 32px);overflow:auto;overscroll-behavior:contain;display:none;padding:14px;animation:rise .18s cubic-bezier(.22,1,.36,1)}
      .head{display:flex;align-items:flex-start;gap:10px}
      .titles{flex:1;min-width:0}
      .count{font-size:16px;font-weight:700;line-height:1.3;color:var(--k-strong);font-variant-numeric:tabular-nums}
      .dest-row{display:flex;align-items:baseline;gap:6px;min-width:0;margin-top:1px}
      .dest{min-width:0;color:var(--k-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dest b{color:var(--k-soft);font-weight:600}
      .dest-change,.text-btn{flex:none;min-height:0;padding:0 2px;border:0;background:none;color:var(--k-link);font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:2px}
      .dest-change:hover:not(:disabled),.text-btn:hover:not(:disabled){background:none;color:var(--k-link-hover)}
      .pick{margin-top:10px}
      .pick label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--k-muted)}
      select{flex:1;min-width:0;min-height:30px;font:500 12.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--k-ground2);color:var(--k-strong);border:1px solid color-mix(in srgb,var(--k-strong) 22%,transparent);border-radius:7px;padding:4px 6px}
      select:focus-visible{outline:2px solid var(--k-focus);outline-offset:2px}
      .preview{list-style:none;margin:12px 0 0;padding:6px 8px;border-radius:9px;background:color-mix(in srgb,var(--k-strong) 5%,transparent);border:1px solid color-mix(in srgb,var(--k-strong) 7%,transparent);display:grid;grid-template-columns:minmax(0,1fr);gap:1px;max-height:10.5em;overflow:auto;overscroll-behavior:contain}
      .preview li{min-width:0}
      .preview label{display:flex;align-items:center;gap:8px;min-width:0;padding:2px 0;cursor:pointer;font-size:12.5px}
      .preview input{flex:none;margin:0;width:14px;height:14px;accent-color:var(--k-accent)}
      .preview input:focus-visible{outline:2px solid var(--k-focus);outline-offset:2px}
      .preview .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--k-ink)}
      .preview .h{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--k-muted);font-size:11.5px}
      .preview li.empty .t{color:var(--k-muted);font-style:italic}
      .preview li.off .t,.preview li.off .h{text-decoration:line-through;color:var(--k-faint)}
      .preview .tag{flex:none;padding:0 5px;border:1px solid color-mix(in srgb,var(--k-strong) 24%,transparent);border-radius:4px;color:var(--k-soft);font-size:10.5px;font-weight:600;line-height:1.5}
      .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .chip{min-height:28px;padding:0 10px;border-radius:999px;font-size:12px}
      .chip svg{display:none;width:13px;height:13px;margin-left:-2px;stroke-width:2.2}
      .chip[aria-pressed="true"]{background:var(--k-accent);border-color:var(--k-accent);color:var(--k-on-accent)}
      .chip[aria-pressed="true"]:hover:not(:disabled){background:var(--k-accent-hover);border-color:var(--k-accent-hover)}
      .chip[aria-pressed="true"] svg{display:block}
      .choice{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;margin:8px 2px 0;font-size:12px;color:var(--k-soft)}
      .choice label{display:flex;align-items:center;gap:7px;cursor:pointer}
      .choice input{flex:none;margin:0;width:14px;height:14px;accent-color:var(--k-accent)}
      .choice input:focus-visible{outline:2px solid var(--k-focus);outline-offset:2px}
      .note{margin:6px 2px 0;color:var(--k-muted);font-size:12px}
      .warning{margin-top:10px;color:var(--k-warn);font-size:12px;overflow-wrap:anywhere}
      .warning:empty,.status:empty,.preview:empty,.dest:empty,.note:empty{display:none}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
      button{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 12.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border:1px solid color-mix(in srgb,var(--k-strong) 16%,transparent);border-radius:8px;padding:0 12px;min-height:34px;background:color-mix(in srgb,var(--k-strong) 7%,transparent);color:var(--k-strong);cursor:pointer;transition:background-color .15s,border-color .15s}
      button:hover:not(:disabled){background:color-mix(in srgb,var(--k-strong) 14%,transparent);border-color:color-mix(in srgb,var(--k-strong) 28%,transparent)}
      button:focus-visible{outline:2px solid var(--k-focus);outline-offset:2px}
      button:disabled{opacity:.45;cursor:default}
      button svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .primary{background:var(--k-accent);border-color:var(--k-accent);color:var(--k-on-accent)}
      .primary:hover:not(:disabled){background:var(--k-accent-hover);border-color:var(--k-accent-hover)}
      .icon{width:30px;min-height:30px;padding:0;border-color:transparent;background:transparent;color:var(--k-muted)}
      .icon:hover:not(:disabled){background:color-mix(in srgb,var(--k-strong) 10%,transparent);border-color:transparent;color:var(--k-strong)}
      .cancel{min-height:30px}
      .menu-toggle[aria-expanded="true"]{background:color-mix(in srgb,var(--k-strong) 16%,transparent);border-color:color-mix(in srgb,var(--k-strong) 30%,transparent)}
      .menu{display:grid;gap:1px;margin-top:6px;padding:4px;border-radius:10px;background:var(--k-ground2);border:1px solid color-mix(in srgb,var(--k-strong) 12%,transparent)}
      .menu button{justify-content:space-between;min-height:31px;border-color:transparent;background:transparent;font-weight:500;padding:0 10px}
      .menu button:hover:not(:disabled),.menu button:focus-visible{background:color-mix(in srgb,var(--k-strong) 10%,transparent);border-color:transparent;outline-offset:-2px}
      kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--k-muted);border:1px solid color-mix(in srgb,var(--k-strong) 18%,transparent);border-radius:4px;padding:2px 5px}
      .confirm{margin-top:12px;padding:10px;border-radius:9px;background:color-mix(in srgb,var(--k-strong) 6%,transparent);border:1px solid color-mix(in srgb,var(--k-strong) 16%,transparent)}
      .confirm.strong{background:color-mix(in srgb,var(--k-warn) 10%,transparent);border-color:color-mix(in srgb,var(--k-warn) 60%,transparent)}
      .confirm p{margin:0 0 8px;font-size:12.5px;color:var(--k-strong);overflow-wrap:anywhere}
      .confirm-actions{display:flex;flex-wrap:wrap;gap:6px}
      .progress{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--k-soft)}
      .progress span{flex:1;min-width:0}
      .progress button{min-height:28px}
      .status{margin-top:10px;padding-top:10px;border-top:1px solid color-mix(in srgb,var(--k-strong) 10%,transparent);font-size:12px;color:var(--k-soft);overflow-wrap:anywhere}
      .status button{margin-top:8px;min-height:30px}
      .notice{right:16px;bottom:16px;width:390px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 10px 10px 12px;animation:rise .18s cubic-bezier(.22,1,.36,1)}
      .notice-text{flex:1 1 200px;min-width:0;margin:0;color:var(--k-strong);font-weight:600;overflow-wrap:anywhere}
      .notice-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto}
      .notice-actions button{min-height:30px}
      @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(max-width:460px){.bar,.notice{left:12px;right:12px;bottom:12px;width:auto}.hint span{display:none}}
      @media(prefers-reduced-motion:reduce){.bar,.notice{animation:none}*{transition:none!important}}
      @media(forced-colors:active){.panel,button,.menu,.confirm{border:1px solid CanvasText}.hit,.rect{outline:2px solid Highlight}}
      [hidden]{display:none!important}</style><div class="shield"></div><div class="hits"></div><div class="rect" hidden></div><div class="badge" hidden></div><div class="panel hint">${mark('hint')}<div><strong>Drag across the links you want</strong> <span>· Scroll to extend · Esc to cancel</span></div><button class="cancel" aria-label="Cancel link selection">Cancel</button></div><div class="panel bar" role="dialog" aria-label="Captured links"><div class="head">${mark('bar')}<div class="titles"><div class="count" aria-live="polite"></div><div class="dest-row"><div class="dest"></div><button type="button" class="dest-change" hidden>Change</button></div></div><button class="dismiss icon" aria-label="Close captured links" title="Close (Esc)">${ICON_X}</button></div><div class="pick" hidden><label>Save to <select class="dest-select"></select></label></div><div class="chips" role="group" aria-label="Filter the ticked links" hidden><button type="button" class="chip" data-filter="all" aria-pressed="true" title="Tick again the links a filter unticked">${ICON_CHECK}All</button><button type="button" class="chip" data-filter="other" aria-pressed="false" title="Keep only links to other sites ticked">${ICON_CHECK}Other sites</button><button type="button" class="chip" data-filter="pdf" aria-pressed="false" title="Keep only links to PDF files ticked">${ICON_CHECK}PDFs</button><button type="button" class="chip" data-filter="same" aria-pressed="false" title="Keep only links on this site ticked">${ICON_CHECK}Same site</button></div><ul class="preview" aria-label="Captured links: untick any to leave it out"></ul><p class="choice leftout" hidden><span class="leftout-text"></span><button type="button" class="text-btn leftout-include">Include them</button><button type="button" class="text-btn leftout-remember" hidden>Always include them</button></p><p class="choice skip" hidden><label><input type="checkbox" class="skip-saved"><span class="skip-text"></span></label><button type="button" class="text-btn skip-remember" hidden>Make this the default</button></p><p class="note"></p><div class="warning"></div><div class="confirm" role="group" aria-label="Confirm opening links" hidden><p class="confirm-text"></p><div class="confirm-actions"><button class="confirm-yes primary"></button><button class="confirm-window">New window</button><button class="confirm-no">Cancel</button></div></div><div class="progress" role="status" hidden><span class="progress-text"></span><button class="progress-cancel">Cancel</button></div><div class="actions"><button class="copy primary" data-key="c" title="Copy anchor text and URL as two spreadsheet columns (C)">${ICON_COPY}Copy text + URL</button><button class="add" data-key="a" title="Add these links to the collection (A)">${ICON_PLUS}Add to collection</button><button class="open" data-key="o" title="Open the web links in new background tabs (O)">${ICON_OPEN}<span class="open-label">Open in tabs</span></button><button class="review" data-key="r" title="Save and review these links in the full view (R)">${ICON_LIST}Review</button><button class="region" data-key="n" title="Save these links and select another region (N)">${ICON_REGION}Add another region</button><button class="menu-toggle" data-key="m" aria-haspopup="menu" aria-expanded="false" title="More actions (M)">${ICON_MORE}More</button></div><div class="menu" role="menu" aria-label="More actions" hidden><button role="menuitem" class="m-window" data-key="w" title="Open the web links in a new window (W)">Open in a new window<kbd aria-hidden="true">W</kbd></button><button role="menuitem" class="m-group" data-key="g" title="Open the web links as one tab group (G)">Open as a tab group<kbd aria-hidden="true">G</kbd></button><button role="menuitem" class="m-urls" data-key="u" title="Copy the URLs, one per line (U)">Copy URLs<kbd aria-hidden="true">U</kbd></button><button role="menuitem" class="m-markdown" data-key="k" title="Copy as Markdown links (K)">Copy as Markdown<kbd aria-hidden="true">K</kbd></button><button role="menuitem" class="m-rich" data-key="l" title="Copy as rich links that keep their anchor text clickable in documents (L)">Copy as rich links<kbd aria-hidden="true">L</kbd></button><button role="menuitem" class="m-download" data-key="d" title="Download these links as an Excel workbook (D)">Download this selection<kbd aria-hidden="true">D</kbd></button><button role="menuitem" class="m-bookmark" data-key="b" title="Save the web links as a bookmark folder (B)">Bookmark this selection<kbd aria-hidden="true">B</kbd></button></div><div class="status" role="status" aria-live="polite"></div></div><div class="panel notice" hidden><p class="notice-text" role="status"></p><div class="notice-actions"><button type="button" class="notice-undo" hidden>Undo</button><button type="button" class="notice-show">Show links</button><button type="button" class="notice-close icon" aria-label="Close notice" title="Close (Esc)">${ICON_X}</button></div></div>`;
    document.documentElement.append(host);
    const $=selector=>shadow.querySelector(selector);
    const shield=$('.shield'), box=$('.rect'), badge=$('.badge'), hits=$('.hits'), bar=$('.bar');
    let dragging=false, start=null, pointer=null, frame=null, entries=[], selected=[], ticks=[], warnings=[],inaccessibleFrames=0,committed=false,destination='',destinationId='',chosen=!!lastDestinationId,collections=[],destinationRequest=0,saveInFlight=null,savedBatchId='',savedCollectionId='',opening=null,pendingOpen=null;
    // 0.4.0: preview rows, links unticked as page chrome or by the active filter, links already saved,
    // this card's Skip saved choice, the left-out note's state, and the notice's timer.
    let rows=[],chromeOff=new Set(),filterOff=new Set(),filter='all',savedUrls=new Set(),savedRequest=0,skip=false,leftState='',leftIncluded=0,noticeTimer=0;
    const swept=new Map();
    const state={close,progress,idle:()=>!$('.notice').hidden&&bar.style.display!=='block'};active=state;
    for(const button of shadow.querySelectorAll('button[data-key]'))button.setAttribute('aria-keyshortcuts',button.dataset.key.toUpperCase());

    // After release, highlights stay on their links as the page or a scrolling box scrolls, one
    // repaint per frame: every selected link (up to 250), and unticked ones only outlined.
    let followFrame=null,following=false;
    function paintHits(){
      followFrame=null;hits.replaceChildren();
      selected.slice(0,250).forEach((entry,index)=>{for(const r of rectsNow(entry.element)){const hit=document.createElement('div');hit.className=ticks[index]===false?'hit off':'hit';hit.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.right-r.left}px;height:${r.bottom-r.top}px`;hits.append(hit);}});
    }
    function followScroll(){if(following&&!followFrame)followFrame=requestAnimationFrame(paintHits);}
    function follow(){following=true;paintHits();listen(window,'scroll',followScroll,true);listen(window,'resize',followScroll);}
    function close() {
      if(frame)cancelAnimationFrame(frame);if(followFrame)cancelAnimationFrame(followFrame);unlisten(window,'scroll',followScroll,true);unlisten(window,'resize',followScroll);clearTimeout(noticeTimer);unlisten(document,'keydown',escape,true);try{chrome.storage.onChanged.removeListener(followState);}catch{/* extension reloaded */}host.remove();if(overlayHost===host)overlayHost=null;if(active===state)active=null;held=false;
    }
    // Only an open card follows saved changes (its destination); a page without one never
    // receives the whole saved state on every change, even with all-sites access.
    function followState(changes,area){if(area==='local'&&changes.linkMeteorState)refreshDestination();}
    try{chrome.storage.onChanged.addListener(followState);}catch{/* extension reloaded: saving reports it */}
    // Escape closes the innermost open part first: the menu, then an opening confirmation, then the card.
    function escape(event){
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();
      if(!$('.menu').hidden){closeMenu(true);return;}
      if(!$('.confirm').hidden){hideConfirm(true);return;}
      if(!$('.fconfirm').hidden){hideFileConfirm(true);return;}
      if(!$('.pick').hidden){togglePicker(false);return;}
      close();
    }
    listen(document,'keydown',escape,true);
    $('.cancel').onclick=close;$('.dismiss').onclick=close;

    function begin(event, now) {
      if(event.button!==0)return;
      event.preventDefault();event.stopImmediatePropagation();
      dragging=true;pointer={x:event.clientX,y:event.clientY};start={x:event.clientX+scrollX,y:event.clientY+scrollY};
      if(now)pointer={x:now.x,y:now.y};
      const result=collect(true);entries=result.records;warnings=result.warnings;inaccessibleFrames=result.inaccessibleFrames;
      shield.setPointerCapture?.(event.pointerId);box.hidden=false;badge.hidden=false;$('.hint').style.pointerEvents='none';
      refresh();frame=requestAnimationFrame(tick);
    }
    function currentRect(){return{left:Math.min(start.x-scrollX,pointer.x),top:Math.min(start.y-scrollY,pointer.y),right:Math.max(start.x-scrollX,pointer.x),bottom:Math.max(start.y-scrollY,pointer.y)};}
    function refresh(rescan=false) {
      if(!start)return;
      if(rescan){const result=collect(true);entries=result.records;warnings=result.warnings;inaccessibleFrames=result.inaccessibleFrames;}
      const rect=currentRect();box.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.right-rect.left}px;height:${rect.bottom-rect.top}px`;
      const matched=entries.filter(entry=>entry.rects.some(r=>positive(intersect(rect,r))));
      const combined=new Map(swept);for(const entry of matched)combined.set(entry.element,entry);
      selected=[...combined.values()].slice(0,MAX_LINKS);hits.replaceChildren();
      for(const entry of matched.slice(0,250)){for(const r of entry.rects){const hit=document.createElement('div');hit.className='hit';hit.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.right-r.left}px;height:${r.bottom-r.top}px`;hits.append(hit);}}
      badge.textContent=`${selected.length} link${selected.length===1?'':'s'}`;badge.style.left=Math.min(innerWidth-90,Math.max(4,pointer.x+12))+'px';badge.style.top=Math.min(innerHeight-35,Math.max(4,pointer.y+12))+'px';
    }
    function scrollTarget() {
      host.style.setProperty('visibility','hidden','important');const under=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,pointer.x)),Math.max(0,Math.min(innerHeight-1,pointer.y)));host.style.removeProperty('visibility');
      for(let element=under;element&&element!==document.documentElement;element=element.parentElement || element.getRootNode()?.host){
        const style=getComputedStyle(element),r=element.getBoundingClientRect();
        const dy=pointer.y<r.top+30?-16:pointer.y>r.bottom-30?16:0;
        const dx=pointer.x<r.left+30?-16:pointer.x>r.right-30?16:0;
        if((dy&&/(auto|scroll)/.test(style.overflowY)&&element.scrollHeight>element.clientHeight)||(dx&&/(auto|scroll)/.test(style.overflowX)&&element.scrollWidth>element.clientWidth))return{element,dx,dy};
      }
      return{element:window,dx:pointer.x<30?-16:pointer.x>innerWidth-30?16:0,dy:pointer.y<45?-16:pointer.y>innerHeight-45?16:0};
    }
    function tick(){
      if(!dragging)return;
      const {element,dx,dy}=scrollTarget();
      if(dx||dy){const before=[element===window?scrollX:element.scrollLeft,element===window?scrollY:element.scrollTop];for(const entry of selected)swept.set(entry.element,entry);element.scrollBy(dx,dy);const after=[element===window?scrollX:element.scrollLeft,element===window?scrollY:element.scrollTop];if(before[0]!==after[0]||before[1]!==after[1])refresh(true);}
      frame=requestAnimationFrame(tick);
    }
    shield.addEventListener('pointerdown',event=>begin(event));
    shield.addEventListener('pointermove',event=>{if(dragging){event.preventDefault();pointer={x:event.clientX,y:event.clientY};refresh();}});
    shield.addEventListener('wheel',event=>{if(!dragging)return;event.preventDefault();for(const entry of selected)swept.set(entry.element,entry);host.style.setProperty('visibility','hidden','important');let target=document.elementFromPoint(event.clientX,event.clientY);host.style.removeProperty('visibility');while(target&&target!==document.documentElement){const s=getComputedStyle(target);if(/(auto|scroll)/.test(s.overflowY)&&target.scrollHeight>target.clientHeight)break;target=target.parentElement;}if(target&&target!==document.documentElement)target.scrollBy(event.deltaX,event.deltaY);else window.scrollBy(event.deltaX,event.deltaY);refresh(true);},{passive:false});
    shield.addEventListener('pointercancel',close);
    shield.addEventListener('pointerup',event=>{
      if(!dragging)return;event.preventDefault();event.stopImmediatePropagation();dragging=false;if(frame)cancelAnimationFrame(frame);refresh(true);shield.releasePointerCapture?.(event.pointerId);shield.style.pointerEvents='none';box.hidden=true;badge.hidden=true;$('.hint').hidden=true;
      // With content links only, links in page chrome start unticked.
      ticks=selected.map(entry=>!(captureSettings.contentOnly&&entry.chrome));
      chromeOff=new Set(ticks.flatMap((ticked,index)=>ticked?[]:[index]));leftState=chromeOff.size?'left':'';skip=!!captureSettings.skipSaved;
      renderPreview();updateCounts();follow();
      $('.warning').textContent=warnings.join(' ');
      // After a drag: the card, or copy or add right away with a notice.
      const after=captureSettings.afterDrag;
      if((after==='copy'||after==='add')&&tickedLinks().length)(after==='copy'?quickCopy:quickAdd)();
      else showCard();
    });
    function showCard(){
      hideNotice();bar.style.display='block';
      if(!selected.length)$('.status').textContent='No links in this region. Close and select another area.';
      $('.copy').focus();checkSaved();
    }

    /* Ticked links: every card action uses only these. */
    const tickedLinks=()=>selected.filter((entry,index)=>ticks[index]).map(entry=>entry.link);
    function renderPreview() {
      const list=$('.preview');list.replaceChildren();rows=[];
      selected.slice(0,PREVIEW_LIMIT).forEach(({link},index)=>{
        const item=document.createElement('li'),label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span'),where=document.createElement('span'),tag=document.createElement('span');
        check.type='checkbox';check.checked=ticks[index];
        text.className='t';text.textContent=link.anchorText || (link.accessibleLabel?`No anchor text (labeled “${link.accessibleLabel}”)`:'No anchor text');
        where.className='h';try{const url=new URL(link.url);where.textContent=url.host || url.protocol.replace(':','');}catch{where.textContent='';}
        tag.className='tag';tag.textContent='Saved';tag.hidden=!savedUrls.has(link.url);
        if(!link.anchorText)item.classList.add('empty');
        item.classList.toggle('off',!ticks[index]);
        label.title=link.url;label.append(check,text,where,tag);item.append(label);list.append(item);rows.push({item,check,tag});
        // A choice made by hand is the person's own: filters and Include them leave it alone.
        check.addEventListener('change',()=>{ticks[index]=check.checked;filterOff.delete(index);chromeOff.delete(index);item.classList.toggle('off',!check.checked);updateCounts();});
      });
    }
    function syncTicks(){rows.forEach(({item,check},index)=>{check.checked=ticks[index];item.classList.toggle('off',!ticks[index]);});}
    function markSaved(){rows.forEach(({tag},index)=>{tag.hidden=!savedUrls.has(selected[index].link.url);});}
    function updateCounts() {
      followScroll();
      const ticked=tickedLinks(),n=ticked.length,web=webUrls(ticked).length;
      $('.count').textContent=n===selected.length?`${selected.length} link${selected.length===1?'':'s'} selected`:`${n} of ${plural(selected.length,'link')} selected`;
      $('.open-label').textContent=web?`Open ${web} in tabs`:'Open in tabs';
      for(const cls of ['copy','review','region','menu-toggle','m-urls','m-markdown','m-rich','m-download'])$('button.'+cls).disabled=!n;
      $('button.add').disabled=!n||committed;
      for(const cls of ['open','m-window','m-group','m-bookmark'])$('button.'+cls).disabled=!web||!!opening;
      if(pendingOpen&&pendingOpen.count!==web)hideConfirm();
      renderFiles();
      renderChoices();
    }
    // The filter chips, the left-out note, Skip saved and the preview note follow the ticks.
    function renderChoices() {
      $('.chips').hidden=selected.length<2;
      for(const chip of shadow.querySelectorAll('.chip'))chip.setAttribute('aria-pressed',String(chip.dataset.filter===filter));
      $('.leftout').hidden=leftState==='left'?!chromeOff.size:!leftState;
      $('.leftout-text').textContent=leftState==='left'?`Left out ${plural(chromeOff.size,'navigation link')}.`:leftState==='included'?`Included ${plural(leftIncluded,'navigation link')}.`:'From now on, navigation links are included. Change this in Link Meteor’s settings.';
      $('.leftout-include').hidden=leftState!=='left';$('.leftout-remember').hidden=leftState!=='included'||!captureSettings.contentOnly;
      const saved=committed?0:tickedLinks().filter(link=>savedUrls.has(link.url)).length;
      $('.skip').hidden=!saved;$('.skip-saved').checked=skip;
      $('.skip-text').textContent=saved===1?'Skip the link already saved':`Skip the ${saved.toLocaleString()} links already saved`;
      $('.skip-remember').hidden=skip===!!captureSettings.skipSaved;
      const rest=selected.length-PREVIEW_LIMIT,kept=ticks.slice(PREVIEW_LIMIT).filter(Boolean).length;
      $('.note').textContent=rest<=0?'':kept===rest?`Showing the first ${PREVIEW_LIMIT.toLocaleString()}. The other ${rest.toLocaleString()} links are included.`:`Showing the first ${PREVIEW_LIMIT.toLocaleString()}. ${kept.toLocaleString()} of the other ${rest.toLocaleString()} links are included.`;
    }

    /* Filters, left-out navigation links and Skip saved. */
    // A filter unticks the links that don't match; All, or the chosen filter again, ticks them again.
    function applyFilter(name){
      for(const index of filterOff)ticks[index]=true;
      filterOff.clear();filter=name;
      if(name!=='all')selected.forEach((entry,index)=>{if(ticks[index]&&!FILTERS[name](entry.link)){ticks[index]=false;filterOff.add(index);}});
      syncTicks();updateCounts();
    }
    for(const chip of shadow.querySelectorAll('.chip'))chip.onclick=()=>applyFilter(chip.dataset.filter===filter?'all':chip.dataset.filter);
    $('.leftout-include').onclick=()=>{
      for(const index of chromeOff){if(FILTERS[filter](selected[index].link))ticks[index]=true;else filterOff.add(index);}
      leftIncluded=chromeOff.size;chromeOff.clear();leftState='included';syncTicks();updateCounts();
      ($('.leftout-remember').hidden?$('.copy'):$('.leftout-remember')).focus();
    };
    // Remembering sends only the one choice (capture.preference); the card follows it at once.
    $('.leftout-remember').onclick=()=>run(async()=>{
      captureSettings.contentOnly=(await request({type:'capture.preference',contentOnly:false})).contentOnly;
      leftState='remembered';renderChoices();$('.copy').focus();
    });
    $('.skip-saved').addEventListener('change',()=>{skip=$('.skip-saved').checked;renderChoices();});
    $('.skip-remember').onclick=()=>run(async()=>{
      captureSettings.skipSaved=(await request({type:'capture.preference',skipSaved:skip})).skipSaved;
      renderChoices();$('.skip-saved').focus();
      $('.status').textContent=skip?'From now on, links already saved are skipped when adding.':'From now on, links already saved are added again.';
    });
    // Marks rows whose URL the destination already holds: when the card opens and when its destination changes.
    async function checkSaved(){
      if(committed||!selected.length||bar.style.display!=='block')return;
      const sequence=++savedRequest;
      try{
        const {saved}=await request({type:'capture.saved',urls:[...new Set(selected.map(entry=>entry.link.url))],...(destinationId?{collectionId:destinationId}:{})});
        if(active!==state||committed||sequence!==savedRequest)return;
        savedUrls=new Set(saved);markSaved();updateCounts();
      }catch{/* the marks are only a hint */}
    }

    /* Destination collection, chosen on the "Adds to" line. */
    function renderDest() {
      const dest=$('.dest'),change=$('.dest-change');dest.replaceChildren();
      change.hidden=!destination||committed||collections.length<2;
      if(!destination)return;
      const name=document.createElement('b');name.textContent=destination;
      dest.append(committed?'Saved to ':'Adds to ',name);dest.title=destination;
      change.setAttribute('aria-label',`Change destination collection, now ${destination}`);change.setAttribute('aria-expanded',String(!$('.pick').hidden));
    }
    $('.dest-change').onclick=()=>togglePicker($('.pick').hidden);
    function renderPicker() {
      const select=$('.dest-select');select.replaceChildren();
      for(const collection of collections){const option=document.createElement('option');option.value=collection.id;option.textContent=`${collection.name} (${collection.count.toLocaleString()})`;select.append(option);}
      select.value=destinationId;
    }
    function togglePicker(open) {
      $('.pick').hidden=!open;renderDest();
      if(open)$('.dest-select').focus();else if(!$('.dest-change').hidden)$('.dest-change').focus();
    }
    $('.dest-select').addEventListener('change',()=>{
      destinationId=$('.dest-select').value;chosen=true;lastDestinationId=destinationId;
      destination=collections.find(collection=>collection.id===destinationId)?.name || '';
      togglePicker(false);checkSaved();
    });
    async function refreshDestination() {
      const sequence=++destinationRequest;
      try {
        const list=await request({type:'collections.list'});
        if(active!==state || committed || sequence!==destinationRequest)return;
        collections=list.collections;
        const before=destinationId,wanted=chosen?(destinationId || lastDestinationId):'';
        if(wanted&&collections.some(collection=>collection.id===wanted))destinationId=wanted;
        else {
          if(chosen&&destinationId)$('.status').textContent='The collection you chose was deleted, so these links now add to the active collection.';
          chosen=false;destinationId=list.activeCollectionId;
        }
        destination=collections.find(collection=>collection.id===destinationId)?.name || '';
        renderPicker();renderDest();
        if(destinationId!==before)checkSaved();
      } catch { /* Saving still reports the actual destination from its receipt. */ }
    }
    const destinationReady=refreshDestination();

    /* Saving, reviewing and another region. */
    function savedBatch(result) {
      const collectionId=result.collectionId || destinationId || result.state.activeCollectionId;
      const collection=result.state.collections.find(item=>item.id===collectionId);
      return {name:collection?.name || '',collectionId,batchId:result.batchId ?? (result.count?collection?.links.at(-1)?.batchId || '':'')};
    }
    // The receipt. Adding right away says "Added"; the card keeps its "Saved", unless some were skipped.
    function receipt(result,quick){
      const where=destination?`“${destination}”`:'your active collection',skipped=result.skipped || 0;
      if(!result.count&&skipped)return `Nothing was added: ${plural(skipped,'link')} ${skipped===1?'was':'were'} already in ${where}.`;
      if(skipped)return `Added ${plural(result.count,'link')} to ${where}; ${skipped.toLocaleString()} ${skipped===1?'was':'were'} already saved.`;
      return quick?`Added ${plural(result.count,'link')} to ${where}.`:`Saved ${result.count} link${result.count===1?'':'s'} to ${where}.`;
    }
    async function save(review=false,quick=false){
      if(saveInFlight){await saveInFlight;if(review)await openReview();return;}
      if(committed){if(review)await openReview();return;}
      saveInFlight=(async()=>{
        const result=await request({type:'capture.commit',links:tickedLinks(),inaccessibleFrames,review,skipSaved:skip,...(destinationId?{collectionId:destinationId}:{})});
        committed=true;const saved=savedBatch(result);destination=saved.name;savedBatchId=saved.batchId;savedCollectionId=saved.collectionId;
        $('.pick').hidden=true;$('.add').disabled=true;$('.add').innerHTML=`${ICON_CHECK}Added`;renderDest();renderChoices();
        $('.status').textContent=`${receipt(result,quick)} ${result.warning || ''}`.trim();
      })();
      try {await saveInFlight;} finally {saveInFlight=null;}
    }
    async function openReview(view='links'){await request({type:'ui.open',view,...(savedBatchId?{batchId:savedBatchId}:{})});}

    /* Copying. Rich links go on the clipboard as HTML and plain text; returns 'rich', 'plain' or '' (blocked). */
    async function copyLinks(format){
      const {text,html}=await request({type:'capture.copy',links:tickedLinks(),format});
      return clip(text,html,shadow);
    }
    async function copy(format){
      const how=await copyLinks(format),n=tickedLinks().length;
      $('.status').textContent=!how?'Clipboard access was blocked. Review the links and use Export instead.'
        :format==='rich'?(how==='rich'?`Copied ${plural(n,'link')} as rich links. Paste into Google Docs, Word or Notion to keep them clickable.`:`Copied ${plural(n,'link')} as plain text, because this page doesn’t allow rich links.`)
        :format==='text'?`Copied ${plural(n,'URL')}, one per line.`:format==='markdown'?`Copied ${plural(n,'Markdown link')}.`:'Copied anchor text and URL as two spreadsheet columns.';
    }

    /* After a drag: copy or add right away, then a notice with Show links (and Undo after adding). */
    async function quickCopy(){
      const format=COPIED_AS[captureSettings.afterDragFormat]?captureSettings.afterDragFormat:'tsv',n=tickedLinks().length;
      let text;
      try{
        const how=await copyLinks(format);
        text=!how?'Clipboard access was blocked. Choose Show links to copy from the card.':`Copied ${plural(n,'link')} ${how==='plain'&&format==='rich'?'as plain text':COPIED_AS[format]}.${chromeOff.size?` Left out ${plural(chromeOff.size,'navigation link')}.`:''}`;
      }catch(error){text=String(error.message || error);}
      if(active===state)showNotice(text);
    }
    async function quickAdd(){
      showNotice(`Adding ${plural(tickedLinks().length,'link')}…`);
      try{
        await destinationReady;await save(false,true);
        if(savedBatchId){const undo=document.createElement('button');undo.type='button';undo.textContent='Undo';undo.onclick=()=>run(async()=>{try{await undoAdd();}finally{if(host.isConnected)(committed?$('.copy'):$('button.add')).focus();}},undo);$('.status').append(document.createElement('br'),undo);}
        if(active===state&&!$('.notice').hidden)showNotice($('.status').firstChild.textContent,!!savedBatchId);
      }catch(error){
        $('.status').textContent=String(error.message || error);
        if(active===state&&!$('.notice').hidden)showNotice($('.status').textContent);
      }
    }
    // Undo after adding right away removes exactly that add (capture.undoAdd); the card can add again.
    async function undoAdd(){
      const result=await request({type:'capture.undoAdd',collectionId:savedCollectionId,batchId:savedBatchId});
      committed=false;savedBatchId='';$('.add').innerHTML=`${ICON_PLUS}Add to collection`;
      const text=`Removed ${plural(result.count,'link')} from ${destination?`“${destination}”`:'your active collection'}.`;
      $('.status').textContent=text;if(!$('.notice').hidden)showNotice(text);
      renderDest();updateCounts();refreshDestination();
    }
    function showNotice(text,undo=false){
      const box=$('.notice'),had=box.matches(':focus-within');
      box.hidden=false;$('.notice-undo').hidden=!undo;$('.notice-undo').disabled=false;$('.notice-text').textContent=text;
      if(had&&shadow.activeElement?.hidden)$('.notice-show').focus();
      holdNotice();
    }
    function hideNotice(){clearTimeout(noticeTimer);$('.notice').hidden=true;}
    // The notice closes itself after NOTICE_MS, but not while it has focus or the pointer is over it.
    function holdNotice(){clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{if(bar.style.display!=='block'&&!$('.notice').matches(':focus-within,:hover'))close();},NOTICE_MS);}
    $('.notice').addEventListener('focusout',holdNotice);$('.notice').addEventListener('mouseleave',holdNotice);
    $('.notice-show').onclick=showCard;$('.notice-close').onclick=close;
    // Undo leaves the notice either way, so focus moves to Show links first.
    $('.notice-undo').onclick=async()=>{
      if(shadow.activeElement===$('.notice-undo'))$('.notice-show').focus();
      $('.notice-undo').disabled=true;
      try{await undoAdd();}catch(error){showNotice(String(error.message || error));}
    };

    /* Opening: up to 20 at once, a confirmation above 20, stronger wording above 100, none above 500. */
    function startOpen(mode='tabs'){
      const count=webUrls(tickedLinks()).length;
      if(!count){$('.status').textContent='None of the ticked links are web links, so there is nothing to open.';return;}
      if(count>OPEN_LIMIT){$('.status').textContent=`Link Meteor opens at most ${OPEN_LIMIT} links at a time, and ${count.toLocaleString()} are ticked. Untick some, or review them in the full view. Nothing was opened.`;return;}
      if(count>CONFIRM_ABOVE){showConfirm(mode,count);return;}
      return runOpen(mode,count);
    }
    function showConfirm(mode,count){
      pendingOpen={mode,count};
      const where=mode==='window'?'in a new window':mode==='group'?'as a tab group':'in new tabs';
      $('.confirm-text').textContent=count>STRONG_ABOVE
        ?`Open ${count.toLocaleString()} links ${where}? That is a lot of tabs at once, and Chrome may slow down while they load.${mode==='tabs'?' A new window keeps them together.':''}`
        :`Open ${count.toLocaleString()} links ${where}?`;
      $('.confirm').classList.toggle('strong',count>STRONG_ABOVE);
      $('.confirm-yes').textContent=`Open ${count.toLocaleString()}`;
      $('.confirm-window').hidden=mode!=='tabs';
      $('.confirm').hidden=false;$('.confirm-yes').focus();
    }
    function hideConfirm(focus=false){pendingOpen=null;$('.confirm').hidden=true;if(focus)$('button.open').focus();}
    async function runOpen(mode,count){
      hideConfirm();
      const requestId=randomId();
      opening={requestId,total:count};updateCounts();
      $('.progress-text').textContent=`Opening ${plural(count,'link')}…`;$('.progress').hidden=false;$('.progress-cancel').disabled=false;
      try{
        const result=await request({type:'capture.open',links:tickedLinks(),mode,confirmed:count>CONFIRM_ABOVE,requestId,...(destinationId?{collectionId:destinationId}:{})});
        const parts=[result.cancelled?`Stopped after opening ${result.opened.toLocaleString()} of ${plural(count,'link')}. The tabs already open stay open.`
          :mode==='window'?`Opened ${plural(result.opened,'link')} in a new window.`
          :mode==='group'?(result.groupTitled?`Opened ${plural(result.opened,'link')} in a tab group named “${destination}”.`:`Opened ${plural(result.opened,'link')} in an unnamed tab group. To name groups after the collection, open a group once from the full view, where Chrome can ask for tab-group access.`)
          :`Opened ${plural(result.opened,'link')} in new tabs.`];
        if(result.failed)parts.push(`${result.failed.toLocaleString()} could not open.`);
        $('.status').textContent=parts.join(' ');
      }finally{opening=null;if(host.isConnected){$('.progress').hidden=true;updateCounts();}}
    }
    function progress(update){
      if(!opening||update.requestId!==opening.requestId)return;
      $('.progress-text').textContent=`Opening ${update.opened.toLocaleString()} of ${plural(update.total,'link')}…`;
    }
    $('.confirm-yes').onclick=()=>run(()=>runOpen(pendingOpen.mode,pendingOpen.count));
    $('.confirm-window').onclick=()=>run(()=>runOpen('window',pendingOpen.count));
    $('.confirm-no').onclick=()=>hideConfirm(true);
    $('.progress-cancel').onclick=()=>run(async()=>{if(!opening)return;$('.progress-cancel').disabled=true;$('.progress-text').textContent='Stopping after this batch…';await request({type:'links.cancel',requestId:opening.requestId});});

    /* Downloading and bookmarking. */
    async function download(){
      const result=await request({type:'capture.export',links:tickedLinks(),format:'xlsx',...(destinationId?{collectionId:destinationId}:{})});
      const data=result.encoding==='base64'?Uint8Array.from(atob(result.data),char=>char.charCodeAt(0)):result.data;
      const href=URL.createObjectURL(new Blob([data],{type:result.mime}));
      const link=document.createElement('a');link.href=href;link.download=result.fileName;link.hidden=true;shadow.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),30000);
      $('.status').textContent=`Downloaded ${result.fileName}.`;
    }
    async function bookmark(){
      try{
        const result=await request({type:'capture.bookmark',links:tickedLinks(),...(destination?{name:destination}:{})});
        const parts=[`Saved ${plural(result.count,'bookmark')} in the folder “${destination || 'Link Meteor'}”.`];
        if(result.skipped)parts.push(`${result.skipped.toLocaleString()} already there were skipped.`);
        if(result.failed)parts.push(`${result.failed.toLocaleString()} could not be saved.`);
        $('.status').textContent=parts.join(' ');
      }catch(error){
        if(!/^Bookmark access is needed/.test(error.message))throw error;
        const status=$('.status');status.textContent=error.message;
        const go=document.createElement('button');go.type='button';go.textContent=committed?'Open the full view':'Add and open the full view';
        go.onclick=()=>run(async()=>{await save();await openReview('export');});
        status.append(document.createElement('br'),go);go.focus();
      }
    }

    /* Download N files (0.4.0): the file links among the ticked ones, saved by Chrome's own downloads. */
    let downloading=null,fileAsk=0;
    function tickedFiles(){const seen=new Set();return tickedLinks().filter(link=>{if(!fileLink(link))return false;const url=new URL(link.url).href;if(seen.has(url))return false;seen.add(url);return true;});}
    function setupFiles(){
      const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.className='m-files';item.dataset.key='f';item.setAttribute('aria-keyshortcuts','F');item.title='Download the files behind the ticked file links, such as PDFs (F)';
      item.innerHTML='<span class="m-files-label">Download files</span><kbd aria-hidden="true">F</kbd>';$('.m-download').after(item);
      const ask=document.createElement('div');ask.className='fconfirm';ask.setAttribute('role','group');ask.setAttribute('aria-label','Confirm downloading files');ask.hidden=true;
      ask.innerHTML='<p class="fconfirm-text"></p><div class="confirm-actions"><button class="fconfirm-yes primary"></button><button class="fconfirm-no">Cancel</button></div>';$('.confirm').after(ask);
      const style=document.createElement('style');style.textContent='.fconfirm{margin-top:12px;padding:10px;border-radius:9px;background:color-mix(in srgb,var(--k-strong) 6%,transparent);border:1px solid color-mix(in srgb,var(--k-strong) 16%,transparent)}.fconfirm p{margin:0 0 8px;font-size:12.5px;color:var(--k-strong);overflow-wrap:anywhere}@media(forced-colors:active){.fconfirm{border:1px solid CanvasText}}';shadow.append(style);
      action('m-files',()=>downloadFiles());
      $('.fconfirm-yes').onclick=()=>run(()=>downloadFiles(true));$('.fconfirm-no').onclick=()=>hideFileConfirm(true);
      // Progress for this card's own download, and the menu's result while the card is open.
      state.fileProgress=update=>{if(!downloading||update.requestId!==downloading.requestId)return false;if(!downloading.stopping&&$('.fstatus-text'))$('.fstatus-text').textContent=`Downloading ${plural(update.total,'file')}: ${update.done.toLocaleString()} done…`;return true;};
      state.fileNote=text=>{$('.status').textContent=text;};
    }
    function renderFiles(){
      const item=$('button.m-files');if(!item)return;
      const n=tickedFiles().length;
      $('.m-files-label').textContent=n?`Download ${plural(n,'file')}`:'Download files';
      item.disabled=!n||!!downloading;
      if(fileAsk&&fileAsk!==n)hideFileConfirm();
    }
    function hideFileConfirm(focus=false){fileAsk=0;$('.fconfirm').hidden=true;if(focus)$('.menu-toggle').focus();}
    // Up to 100 files, confirmed above 10. Without Chrome's download access, the full view asks for it.
    async function downloadFiles(confirmed=false){
      const files=tickedFiles(),n=files.length,status=$('.status');
      if(!n){status.textContent='None of the ticked links are file links, so there is nothing to download.';return;}
      if(n>FILE_LIMIT){status.textContent=`Link Meteor downloads at most ${FILE_LIMIT} files at a time, and ${n.toLocaleString()} file links are ticked. Untick some. Nothing was downloaded.`;return;}
      if(n>FILE_CONFIRM_ABOVE&&!confirmed){fileAsk=n;$('.fconfirm-text').textContent=`Download ${plural(n,'file')} into your downloads folder?`;$('.fconfirm-yes').textContent=`Download ${n.toLocaleString()}`;$('.fconfirm').hidden=false;$('.fconfirm-yes').focus();return;}
      hideFileConfirm();
      const requestId=randomId(),text=document.createElement('span'),stop=document.createElement('button');
      downloading={requestId};renderFiles();
      text.className='fstatus-text';text.textContent=`Downloading ${plural(n,'file')}…`;stop.type='button';stop.className='fcancel';stop.textContent='Cancel';
      stop.onclick=()=>run(async()=>{if(!downloading)return;downloading.stopping=true;stop.disabled=true;text.textContent='Canceling the downloads that haven’t finished…';await request({type:'downloads.cancel',requestId});});
      status.replaceChildren(text,document.createElement('br'),stop);
      try{
        const result=await request({type:'capture.download',links:files,requestId,confirmed:n>FILE_CONFIRM_ABOVE,...(destinationId?{collectionId:destinationId}:{})});
        status.textContent=result.summary;
      }catch(error){
        if(!/^Download access is needed/.test(error.message))throw error;
        status.textContent=error.message;
        const go=document.createElement('button');go.type='button';go.textContent='Open the full view';
        go.onclick=()=>run(()=>request({type:'ui.open'}));
        status.append(document.createElement('br'),go);go.focus();
      }finally{downloading=null;if(host.isConnected)renderFiles();}
    }

    /* More menu. */
    function openMenu(){$('.menu').hidden=false;$('.menu-toggle').setAttribute('aria-expanded','true');$('.menu button:not(:disabled)')?.focus();}
    function closeMenu(focus=false){$('.menu').hidden=true;$('.menu-toggle').setAttribute('aria-expanded','false');if(focus)$('.menu-toggle').focus();}
    $('.menu-toggle').onclick=()=>$('.menu').hidden?openMenu():closeMenu(true);
    $('.menu').addEventListener('keydown',event=>{
      const items=[...shadow.querySelectorAll('.menu button:not(:disabled)')];const at=items.indexOf(shadow.activeElement);
      const next={ArrowDown:at+1,ArrowUp:at-1,Home:0,End:items.length-1}[event.key];
      if(next===undefined||!items.length)return;
      event.preventDefault();event.stopPropagation();items[(next+items.length)%items.length].focus();
    });

    // Runs a card action, reporting any error in the card's status line.
    async function run(fn,button){
      if(button)button.disabled=true;
      try{await fn();}catch(error){$('.status').textContent=String(error.message || error);}
      finally{if(host.isConnected&&button)updateCounts();}
    }
    function action(cls,fn){$('button.'+cls).onclick=()=>{const button=$('button.'+cls);if(!$('.menu').hidden&&button.getAttribute('role')==='menuitem')closeMenu(true);return run(fn,button);};}
    action('add',()=>save());action('review',()=>save(true));action('region',async()=>{await save();arm();});
    action('copy',()=>copy('tsv'));action('m-urls',()=>copy('text'));action('m-markdown',()=>copy('markdown'));action('m-rich',()=>copy('rich'));
    action('open',()=>startOpen('tabs'));action('m-window',()=>startOpen('window'));action('m-group',()=>startOpen('group'));
    action('m-download',download);action('m-bookmark',bookmark);
    setupFiles();

    // One-letter shortcuts, only while focus is inside the card and never while typing or choosing.
    bar.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.key.length!==1)return;
      const target=event.composedPath()[0];
      if(target?.tagName==='SELECT'||target?.tagName==='TEXTAREA'||(target?.tagName==='INPUT'&&target.type!=='checkbox'))return;
      const button=shadow.querySelector(`button[data-key="${CSS.escape(event.key.toLowerCase())}"]`);
      if(!button)return;
      event.preventDefault();event.stopPropagation();
      if(!button.disabled)button.click();
    });

    // A save or copy from Link Meteor's menus (content.notice): the notice alone, with no selection
    // or card. After a save it offers Undo, and Show links opens the full view at those links.
    async function menuNotice({text,added,copy}){
      shield.hidden=true;$('.hint').hidden=true;$('.notice-show').hidden=!added;
      if(added){committed=true;destination=added.name;savedCollectionId=added.collectionId;savedBatchId=added.batchId;$('.notice-show').onclick=()=>openReview().catch(error=>showNotice(String(error.message || error)));}
      if(typeof copy==='string'&&!await clip(copy,'',shadow))text='Clipboard access was blocked, so nothing was copied. Try again, or use the capture card.';
      if(active===state)showNotice(String(text),!!added);
    }

    if(startEvent)begin(startEvent,current);
    else if(notice)menuNotice(notice);
    return {armed:true};
  }

  /* Downloads from the right-click menu (0.4.0) ------------------------------------------------ */
  // The card shows its own download's progress. The menu's result goes in an open card's status,
  // or in a small notice in the card's colors that closes itself after NOTICE_MS.
  let fileNoticeHost=null;
  function fileProgress(message){
    if(active?.fileProgress?.(message)||!message.final||!message.text)return;
    if(active&&!active.idle())active.fileNote?.(message.text);else fileNotice(message.text);
  }
  function fileNotice(text){
    fileNoticeHost?.remove();
    const host=document.createElement('div');host.setAttribute(marker,'notice');host.id='link-meteor-download-notice';
    host.style.cssText='all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;';
    fileNoticeHost=host;themeHost(host);
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{--k-ground:#161d2d;--k-strong:#fff;--k-ink:#eef0f4;--k-muted:#a2a8b5;--k-focus:#c3f344;--k-shadow-45:rgba(8,11,20,.45)}
      .panel{display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;width:390px;max-width:calc(100vw - 32px);padding:10px 10px 10px 12px;background:var(--k-ground);color:var(--k-ink);border:1px solid color-mix(in srgb,var(--k-strong) 10%,transparent);border-radius:14px;box-shadow:0 18px 50px var(--k-shadow-45);font:600 13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      p{flex:1;min-width:0;margin:4px 0;color:var(--k-strong);overflow-wrap:anywhere}
      button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--k-muted);cursor:pointer}
      button:hover{background:color-mix(in srgb,var(--k-strong) 10%,transparent);color:var(--k-strong)}
      button:focus-visible{outline:2px solid var(--k-focus);outline-offset:2px}
      svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
      @media(forced-colors:active){.panel{border:1px solid CanvasText}}</style><div class="panel"><p class="notice-text" role="status"></p><button type="button" class="notice-close" aria-label="Close notice" title="Close">${ICON_X}</button></div>`;
    shadow.querySelector('.notice-text').textContent=text;
    const panel=shadow.querySelector('.panel'),close=()=>{clearTimeout(timer);host.remove();if(fileNoticeHost===host)fileNoticeHost=null;};
    let timer=0;const hold=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!panel.matches(':hover,:focus-within'))close();},NOTICE_MS);};
    shadow.querySelector('.notice-close').onclick=close;panel.addEventListener('mouseleave',hold);panel.addEventListener('focusout',hold);
    document.documentElement.append(host);hold();
  }

  /* Hold-key drag ------------------------------------------------------------------------------ */
  // Letter trigger: hold the letter, then press and drag. Modifier trigger (Command on macOS, Ctrl
  // elsewhere): a plain modifier-click passes through untouched; selection starts only after the
  // pointer moves DRAG_THRESHOLD CSS pixels with the modifier and primary button held.
  let pressStart=null;
  const modifierHeld=event=>MAC?event.metaKey:event.ctrlKey;
  function configureFrom(settings) {
    followSettings(settings);
    holdKey=settings.holdKey;holdTrigger=settings.holdTrigger==='modifier'?'modifier':'letter';
    const origin=location.origin,exceptions=settings.holdExceptions || [];
    holdEnabled=!exceptions.includes(origin)&&(settings.holdScope==='all'||(settings.holdOrigins || []).includes(origin));
  }
  async function configure() {
    try{configureFrom(await request({type:'settings.get'}));}catch{holdEnabled=false;}
  }
  listen(document,'keydown',event=>{if(holdEnabled&&holdTrigger==='letter'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!editable(event)&&event.key.toLowerCase()===holdKey)held=true;},true);
  listen(document,'keyup',event=>{if(event.key.toLowerCase()===holdKey)held=false;},true);
  listen(window,'blur',()=>{held=false;pressStart=null;});
  listen(document,'pointerdown',event=>{
    pressStart=null;
    if(!holdEnabled||busy()||event.button!==0||!event.isPrimary||editable(event))return;
    if(holdTrigger==='letter'){if(held){event.preventDefault();event.stopImmediatePropagation();suppressNextClick();arm(event);}return;}
    if(modifierHeld(event)){const selection=getSelection();pressStart={x:event.clientX,y:event.clientY,pointerId:event.pointerId,selectionEmpty:!selection||selection.isCollapsed||!selection.rangeCount};}
  },true);
  listen(document,'pointermove',event=>{
    if(!pressStart||event.pointerId!==pressStart.pointerId)return;
    if(!(event.buttons&1)||!modifierHeld(event)||!holdEnabled||busy()){pressStart=null;return;}
    if(Math.hypot(event.clientX-pressStart.x,event.clientY-pressStart.y)<DRAG_THRESHOLD)return;
    const from=pressStart;pressStart=null;
    event.preventDefault();event.stopImmediatePropagation();
    if(from.selectionEmpty)getSelection()?.removeAllRanges();
    suppressNextClick();
    arm({button:0,clientX:from.x,clientY:from.y,pointerId:event.pointerId,preventDefault(){},stopImmediatePropagation(){}},{x:event.clientX,y:event.clientY});
  },true);
  const endPress=event=>{if(pressStart&&event.pointerId===pressStart.pointerId)pressStart=null;};
  listen(document,'pointerup',endPress,true);
  listen(document,'pointercancel',endPress,true);
  // Chrome starts dragging a link or image after a few pixels, before the selection threshold.
  // While a modifier press may still become a selection, that native drag would end it.
  listen(document,'dragstart',event=>{if(pressStart){event.preventDefault();}},true);

  /* Link Meteor's menus ------------------------------------------------------------------------- */
  // Chrome gives a menu click the link's address, not its text, so the page records the link under
  // the last right-click, and the background asks for it (content.contextLink).
  let contextAnchor=null;
  listen(document,'contextmenu',event=>{contextAnchor=event.composedPath().find(node=>node?.nodeType===1&&node.matches('a[href],a[xlink\\:href]'))||null;},true);
  // The recorded link when its address matches, otherwise the first link in the page with that address.
  function contextLink(url){
    const recorded=contextAnchor?.isConnected?candidate(contextAnchor,()=>{}):null;
    return recorded?.url===url?recorded:collect().records.find(record=>record.link.url===url)?.link || null;
  }
  // Whether a link intersects the selection, judged in the innermost tree (a shadow root or a
  // document) that holds selected ranges: a link inside a selected shadow host counts through its host.
  function selected(element){
    for(let node=element;node;node=node.getRootNode().host){
      const root=node.getRootNode(),selection=root.getSelection?.();
      const ranges=!selection||selection.isCollapsed?[]:Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i)).filter(range=>!range.collapsed&&range.commonAncestorContainer.getRootNode()===root);
      if(ranges.length)return ranges.some(range=>range.intersectsNode(node));
    }
    return false;
  }
  // Every link that intersects the selection, in the page, its open shadow roots and same-origin frames.
  function selectionLinks(){const {records,warnings}=collect();return {links:records.filter(record=>selected(record.element)).map(record=>record.link),warnings};}
  // Answers the menus' requests; replies {ok, data} or {ok:false, error}.
  function menuMessage(message,reply){
    const answers={'content.contextLink':()=>({link:contextLink(String(message.url || ''))}),'content.selectionLinks':selectionLinks,'content.notice':()=>{arm(null,null,message);return {};}};
    if(!Object.hasOwn(answers,message?.type))return;
    try{reply?.({ok:true,data:answers[message.type]()});}catch(error){reply?.({ok:false,error:String(error.message || error)});}
  }

  const onMessage=(message,sender,reply)=>{
    if(message?.type==='content.configure'){holdEnabled=!!message.enabled;holdKey=message.holdKey;holdTrigger=message.holdTrigger==='modifier'?'modifier':'letter';held=false;pressStart=null;followSettings({card:message.card,...message.capture});}
    if(message?.type==='links.progress')active?.progress(message);
    if(message?.type==='downloads.progress')fileProgress(message);
    menuMessage(message,reply);
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // With the System appearance, an open card follows the computer switching between light and dark.
  listen(darkScheme,'change',()=>themeHost(overlayHost));
  globalThis.__linkMeteor={scan,arm,alive,dispose};configure();
})();
