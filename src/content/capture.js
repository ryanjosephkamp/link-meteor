(() => {
  if (globalThis.__linkMeteor) return;
  const MAX_LINKS = 20000;
  // The card lists at most this many links for unticking; the rest stay included.
  const PREVIEW_LIMIT = 1000;
  // Opening rules shared with the full view: no confirmation up to 20, stronger wording above 100.
  const OPEN_LIMIT = 500, CONFIRM_ABOVE = 20, STRONG_ABOVE = 100;
  // A modifier press becomes a selection only after the pointer moves this far (CSS pixels).
  const DRAG_THRESHOLD = 6;
  const MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const marker = 'data-link-meteor';
  let active = null, held = false, holdKey = 'z', holdTrigger = 'letter', holdEnabled = false, lastDestinationId = '';
  const normalize = value => String(value || '').replace(/\s+/gu,' ').trim();
  const intersect = (a,b) => ({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
  const positive = r => r.right > r.left && r.bottom > r.top;
  const svg = body => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${body}</svg>`;
  const mark = id => `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><defs><linearGradient id="lm-${id}" x1="15.7" y1="8.3" x2="4" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c3f344"/><stop offset="1" stop-color="#c3f344" stop-opacity=".2"/></linearGradient></defs><path d="M13.2 4.6 19.4 10.8 4.6 20.4Q3.6 19.4 4.6 18.4Z" fill="url(#lm-${id})"/><circle cx="16.3" cy="7.7" r="4.4" fill="#c3f344"/></svg>`;
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

  function collect(regional=false) {
    const records = [], warnings = [];
    let inaccessibleFrames=0, malformedLinks=0, capped=false;
    const seenDocuments = new Set();
    const viewport = {left:0,top:0,right:innerWidth,bottom:innerHeight};
    function walk(root, transform={x:0,y:0,sx:1,sy:1}, clip=viewport) {
      if (root.nodeType===9) { if(seenDocuments.has(root))return; seenDocuments.add(root); }
      for (const element of root.querySelectorAll('*')) {
        if (element.closest(`[${marker}]`)) continue;
        if (element.matches('a[href],a[xlink\\:href]')) {
          const link = candidate(element,()=>malformedLinks++);
          if (link) {
            const rects = regional ? geometry(element,transform,clip) : [];
            if (!regional || rects.length) {
              if (records.length===MAX_LINKS) { capped=true; continue; }
              records.push({element,link,rects});
            }
          }
        }
        if (element.shadowRoot) walk(element.shadowRoot,transform,clip);
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
            walk(child,next,intersect(clip,frameClip));
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
    return {links:records.map(record=>record.link),inaccessibleFrames,warnings};
  }

  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'Link Meteor did not respond. Reload the extension and this page.');
    return result.data;
  }

  function editable(event) {
    return event.composedPath().some(node => node?.nodeType===1 && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.getAttribute('role')==='textbox'));
  }


  const plural = (n,word,many=word+'s') => `${Number(n).toLocaleString()} ${n===1?word:many}`;
  function randomId() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* not a secure context */ }
    return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  }
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
    function done() { window.removeEventListener('click',stop,true); window.removeEventListener('pointerup',release,true); window.removeEventListener('pointercancel',release,true); }
    window.addEventListener('click',stop,true);
    window.addEventListener('pointerup',release,true);
    window.addEventListener('pointercancel',release,true);
  }

  function arm(startEvent, current) {
    active?.close();
    held=false;
    const host=document.createElement('div');
    host.setAttribute(marker,'overlay');host.id='link-meteor-overlay';
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
      :host{color-scheme:light dark}
      *{box-sizing:border-box}
      .shield{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none}
      .rect{position:fixed;border:1.5px solid #c3f344;background:rgba(195,243,68,.08);box-shadow:0 0 0 1px rgba(22,29,45,.55),inset 0 0 0 1px rgba(22,29,45,.3);border-radius:3px;pointer-events:none}
      .hit{position:fixed;background:rgba(195,243,68,.38);outline:1px solid rgba(126,168,27,.95);box-shadow:0 0 0 1px rgba(22,29,45,.22);border-radius:3px;pointer-events:none}
      .badge{position:fixed;display:flex;align-items:center;gap:6px;pointer-events:none;background:#161d2d;color:#fff;border-radius:999px;padding:4px 10px 4px 8px;font:700 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap}
      .badge::before{content:"";width:7px;height:7px;border-radius:50%;background:#c3f344;box-shadow:0 0 0 3px rgba(195,243,68,.22)}
      .panel{position:fixed;pointer-events:auto;background:#161d2d;color:#eef0f4;border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 50px rgba(8,11,20,.45),0 2px 6px rgba(8,11,20,.25);font:400 13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:14px;max-width:calc(100vw - 24px);-webkit-font-smoothing:antialiased}
      .hint{top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 12px}
      .hint strong{font-weight:650;color:#fff}.hint span{color:#a2a8b5}
      .mark{width:22px;height:22px;flex:none;display:block}
      .bar{right:16px;bottom:16px;width:400px;max-height:calc(100vh - 32px);overflow:auto;overscroll-behavior:contain;display:none;padding:14px;animation:rise .18s cubic-bezier(.22,1,.36,1)}
      .head{display:flex;align-items:flex-start;gap:10px}
      .titles{flex:1;min-width:0}
      .count{font-size:16px;font-weight:700;line-height:1.3;color:#fff;font-variant-numeric:tabular-nums}
      .dest-row{display:flex;align-items:baseline;gap:6px;min-width:0;margin-top:1px}
      .dest{min-width:0;color:#a2a8b5;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dest b{color:#dfe3ea;font-weight:600}
      .dest-change{flex:none;min-height:0;padding:0 2px;border:0;background:none;color:#c3f344;font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:2px}
      .dest-change:hover:not(:disabled){background:none;color:#d4f86f}
      .pick{margin-top:10px}
      .pick label{display:flex;align-items:center;gap:8px;font-size:12px;color:#a2a8b5}
      select{flex:1;min-width:0;min-height:30px;font:500 12.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0f1422;color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:7px;padding:4px 6px}
      select:focus-visible{outline:2px solid #c3f344;outline-offset:2px}
      .preview{list-style:none;margin:12px 0 0;padding:6px 8px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);display:grid;gap:1px;max-height:10.5em;overflow:auto;overscroll-behavior:contain}
      .preview label{display:flex;align-items:center;gap:8px;min-width:0;padding:2px 0;cursor:pointer;font-size:12.5px}
      .preview input{flex:none;margin:0;width:14px;height:14px;accent-color:#c3f344}
      .preview input:focus-visible{outline:2px solid #c3f344;outline-offset:2px}
      .preview .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eef0f4}
      .preview .h{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a2a8b5;font-size:11.5px}
      .preview li.empty .t{color:#a2a8b5;font-style:italic}
      .preview li.off .t,.preview li.off .h{text-decoration:line-through;color:#7d8394}
      .note{margin:6px 2px 0;color:#a2a8b5;font-size:12px}
      .warning{margin-top:10px;color:#f4c26a;font-size:12px;overflow-wrap:anywhere}
      .warning:empty,.status:empty,.preview:empty,.dest:empty,.note:empty{display:none}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
      button{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 12.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:0 12px;min-height:34px;background:rgba(255,255,255,.07);color:#fff;cursor:pointer;transition:background-color .15s,border-color .15s}
      button:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.28)}
      button:focus-visible{outline:2px solid #c3f344;outline-offset:2px}
      button:disabled{opacity:.45;cursor:default}
      button svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .primary{background:#c3f344;border-color:#c3f344;color:#161d2d}
      .primary:hover:not(:disabled){background:#d4f86f;border-color:#d4f86f}
      .icon{width:30px;min-height:30px;padding:0;border-color:transparent;background:transparent;color:#a2a8b5}
      .icon:hover:not(:disabled){background:rgba(255,255,255,.1);border-color:transparent;color:#fff}
      .cancel{min-height:30px}
      .menu-toggle[aria-expanded="true"]{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.3)}
      .menu{display:grid;gap:1px;margin-top:6px;padding:4px;border-radius:10px;background:#0f1422;border:1px solid rgba(255,255,255,.12)}
      .menu button{justify-content:space-between;min-height:31px;border-color:transparent;background:transparent;font-weight:500;padding:0 10px}
      .menu button:hover:not(:disabled),.menu button:focus-visible{background:rgba(255,255,255,.1);border-color:transparent;outline-offset:-2px}
      kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#a2a8b5;border:1px solid rgba(255,255,255,.18);border-radius:4px;padding:2px 5px}
      .confirm{margin-top:12px;padding:10px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16)}
      .confirm.strong{background:rgba(244,194,106,.1);border-color:rgba(244,194,106,.6)}
      .confirm p{margin:0 0 8px;font-size:12.5px;color:#fff;overflow-wrap:anywhere}
      .confirm-actions{display:flex;flex-wrap:wrap;gap:6px}
      .progress{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:#dfe3ea}
      .progress span{flex:1;min-width:0}
      .progress button{min-height:28px}
      .status{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:#dfe3ea;overflow-wrap:anywhere}
      .status button{margin-top:8px;min-height:30px}
      @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(max-width:460px){.bar{left:12px;right:12px;bottom:12px;width:auto}.hint span{display:none}}
      @media(prefers-reduced-motion:reduce){.bar{animation:none}*{transition:none!important}}
      @media(forced-colors:active){.panel,button,.menu,.confirm{border:1px solid CanvasText}.hit,.rect{outline:2px solid Highlight}}
      [hidden]{display:none!important}</style><div class="shield"></div><div class="hits"></div><div class="rect" hidden></div><div class="badge" hidden></div><div class="panel hint">${mark('hint')}<div><strong>Drag across the links you want</strong> <span>· Scroll to extend · Esc to cancel</span></div><button class="cancel" aria-label="Cancel link selection">Cancel</button></div><div class="panel bar" role="dialog" aria-label="Captured links"><div class="head">${mark('bar')}<div class="titles"><div class="count" aria-live="polite"></div><div class="dest-row"><div class="dest"></div><button type="button" class="dest-change" hidden>Change</button></div></div><button class="dismiss icon" aria-label="Close captured links" title="Close (Esc)">${ICON_X}</button></div><div class="pick" hidden><label>Save to <select class="dest-select"></select></label></div><ul class="preview" aria-label="Captured links: untick any to leave it out"></ul><p class="note"></p><div class="warning"></div><div class="confirm" role="group" aria-label="Confirm opening links" hidden><p class="confirm-text"></p><div class="confirm-actions"><button class="confirm-yes primary"></button><button class="confirm-window">New window</button><button class="confirm-no">Cancel</button></div></div><div class="progress" role="status" hidden><span class="progress-text"></span><button class="progress-cancel">Cancel</button></div><div class="actions"><button class="copy primary" data-key="c" title="Copy anchor text and URL as two spreadsheet columns (C)">${ICON_COPY}Copy text + URL</button><button class="add" data-key="a" title="Add these links to the collection (A)">${ICON_PLUS}Add to collection</button><button class="open" data-key="o" title="Open the web links in new background tabs (O)">${ICON_OPEN}<span class="open-label">Open in tabs</span></button><button class="review" data-key="r" title="Save and review these links in the full view (R)">${ICON_LIST}Review</button><button class="region" data-key="n" title="Save these links and select another region (N)">${ICON_REGION}Add another region</button><button class="menu-toggle" data-key="m" aria-haspopup="menu" aria-expanded="false" title="More actions (M)">${ICON_MORE}More</button></div><div class="menu" role="menu" aria-label="More actions" hidden><button role="menuitem" class="m-window" data-key="w" title="Open the web links in a new window (W)">Open in a new window<kbd aria-hidden="true">W</kbd></button><button role="menuitem" class="m-group" data-key="g" title="Open the web links as one tab group (G)">Open as a tab group<kbd aria-hidden="true">G</kbd></button><button role="menuitem" class="m-urls" data-key="u" title="Copy the URLs, one per line (U)">Copy URLs<kbd aria-hidden="true">U</kbd></button><button role="menuitem" class="m-markdown" data-key="k" title="Copy as Markdown links (K)">Copy as Markdown<kbd aria-hidden="true">K</kbd></button><button role="menuitem" class="m-download" data-key="d" title="Download these links as an Excel workbook (D)">Download this selection<kbd aria-hidden="true">D</kbd></button><button role="menuitem" class="m-bookmark" data-key="b" title="Save the web links as a bookmark folder (B)">Bookmark this selection<kbd aria-hidden="true">B</kbd></button></div><div class="status" role="status" aria-live="polite"></div></div>`;
    document.documentElement.append(host);
    const $=selector=>shadow.querySelector(selector);
    const shield=$('.shield'), box=$('.rect'), badge=$('.badge'), hits=$('.hits'), bar=$('.bar');
    let dragging=false, start=null, pointer=null, frame=null, entries=[], selected=[], ticks=[], warnings=[],inaccessibleFrames=0,committed=false,destination='',destinationId='',chosen=!!lastDestinationId,collections=[],destinationRequest=0,saveInFlight=null,savedBatchId='',opening=null,pendingOpen=null;
    const swept=new Map();
    const state={close,progress};active=state;
    for(const button of shadow.querySelectorAll('button[data-key]'))button.setAttribute('aria-keyshortcuts',button.dataset.key.toUpperCase());

    function close() {
      if(frame)cancelAnimationFrame(frame);document.removeEventListener('keydown',escape,true);try{chrome.storage.onChanged.removeListener(followState);}catch{/* extension reloaded */}host.remove();if(active===state)active=null;held=false;
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
      if(!$('.pick').hidden){togglePicker(false);return;}
      close();
    }
    document.addEventListener('keydown',escape,true);
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
      if(!dragging)return;event.preventDefault();event.stopImmediatePropagation();dragging=false;if(frame)cancelAnimationFrame(frame);refresh(true);shield.releasePointerCapture?.(event.pointerId);shield.style.pointerEvents='none';box.hidden=true;badge.hidden=true;$('.hint').hidden=true;bar.style.display='block';
      ticks=selected.map(()=>true);
      renderPreview();updateCounts();
      $('.warning').textContent=warnings.join(' ');
      if(!selected.length)$('.status').textContent='No links in this region. Close and select another area.';
      $('.copy').focus();
    });

    /* Ticked links: every card action uses only these. */
    const tickedLinks=()=>selected.filter((entry,index)=>ticks[index]).map(entry=>entry.link);
    function renderPreview() {
      const list=$('.preview');list.replaceChildren();
      selected.slice(0,PREVIEW_LIMIT).forEach(({link},index)=>{
        const item=document.createElement('li'),label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span'),where=document.createElement('span');
        check.type='checkbox';check.checked=ticks[index];
        text.className='t';text.textContent=link.anchorText || (link.accessibleLabel?`No anchor text (labeled “${link.accessibleLabel}”)`:'No anchor text');
        where.className='h';try{const url=new URL(link.url);where.textContent=url.host || url.protocol.replace(':','');}catch{where.textContent='';}
        if(!link.anchorText)item.classList.add('empty');
        item.classList.toggle('off',!ticks[index]);
        label.title=link.url;label.append(check,text,where);item.append(label);list.append(item);
        check.addEventListener('change',()=>{ticks[index]=check.checked;item.classList.toggle('off',!check.checked);updateCounts();});
      });
      $('.note').textContent=selected.length>PREVIEW_LIMIT?`Showing the first ${PREVIEW_LIMIT.toLocaleString()}. The other ${(selected.length-PREVIEW_LIMIT).toLocaleString()} links are included.`:'';
    }
    function updateCounts() {
      const ticked=tickedLinks(),n=ticked.length,web=webUrls(ticked).length;
      $('.count').textContent=n===selected.length?`${selected.length} link${selected.length===1?'':'s'} selected`:`${n} of ${plural(selected.length,'link')} selected`;
      $('.open-label').textContent=web?`Open ${web} in tabs`:'Open in tabs';
      for(const cls of ['copy','review','region','menu-toggle','m-urls','m-markdown','m-download'])$('button.'+cls).disabled=!n;
      $('button.add').disabled=!n||committed;
      for(const cls of ['open','m-window','m-group','m-bookmark'])$('button.'+cls).disabled=!web||!!opening;
      if(pendingOpen&&pendingOpen.count!==web)hideConfirm();
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
      togglePicker(false);
    });
    async function refreshDestination() {
      const sequence=++destinationRequest;
      try {
        const list=await request({type:'collections.list'});
        if(active!==state || committed || sequence!==destinationRequest)return;
        collections=list.collections;
        const wanted=chosen?(destinationId || lastDestinationId):'';
        if(wanted&&collections.some(collection=>collection.id===wanted))destinationId=wanted;
        else {
          if(chosen&&destinationId)$('.status').textContent='The collection you chose was deleted, so these links now add to the active collection.';
          chosen=false;destinationId=list.activeCollectionId;
        }
        destination=collections.find(collection=>collection.id===destinationId)?.name || '';
        renderPicker();renderDest();
      } catch { /* Saving still reports the actual destination from its receipt. */ }
    }
    refreshDestination();

    /* Saving, reviewing and another region. */
    function savedBatch(result) {
      const collection=result.state.collections.find(item=>item.id===(destinationId || result.state.activeCollectionId));
      return {name:collection?.name || '',batchId:result.count?collection?.links.at(-1)?.batchId || '':''};
    }
    async function save(review=false){
      if(saveInFlight){await saveInFlight;if(review)await openReview();return;}
      if(committed){if(review)await openReview();return;}
      saveInFlight=(async()=>{
        const result=await request({type:'capture.commit',links:tickedLinks(),inaccessibleFrames,review,...(destinationId?{collectionId:destinationId}:{})});
        committed=true;const saved=savedBatch(result);destination=saved.name;savedBatchId=saved.batchId;
        $('.pick').hidden=true;$('.add').disabled=true;$('.add').innerHTML=`${ICON_CHECK}Added`;renderDest();
        $('.status').textContent=`Saved ${result.count} link${result.count===1?'':'s'} to ${destination?`“${destination}”`:'your active collection'}. ${result.warning || ''}`.trim();
      })();
      try {await saveInFlight;} finally {saveInFlight=null;}
    }
    async function openReview(view='links'){await request({type:'ui.open',view,...(savedBatchId?{batchId:savedBatchId}:{})});}

    /* Copying. */
    async function copy(format){
      const {text}=await request({type:'capture.copy',links:tickedLinks(),format});
      let copied=false;
      try{await navigator.clipboard.writeText(text);copied=true;}catch{
        const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;left:0;top:0;opacity:0';shadow.append(area);area.focus();area.select();copied=document.execCommand('copy');area.remove();
      }
      const n=tickedLinks().length;
      $('.status').textContent=!copied?'Clipboard access was blocked. Review the links and use Export instead.'
        :format==='text'?`Copied ${plural(n,'URL')}, one per line.`:format==='markdown'?`Copied ${plural(n,'Markdown link')}.`:'Copied anchor text and URL as two spreadsheet columns.';
    }

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
    action('copy',()=>copy('tsv'));action('m-urls',()=>copy('text'));action('m-markdown',()=>copy('markdown'));
    action('open',()=>startOpen('tabs'));action('m-window',()=>startOpen('window'));action('m-group',()=>startOpen('group'));
    action('m-download',download);action('m-bookmark',bookmark);

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

    if(startEvent)begin(startEvent,current);
    return {armed:true};
  }

  /* Hold-key drag ------------------------------------------------------------------------------ */
  // Letter trigger: hold the letter, then press and drag. Modifier trigger (Command on macOS, Ctrl
  // elsewhere): a plain modifier-click passes through untouched; selection starts only after the
  // pointer moves DRAG_THRESHOLD CSS pixels with the modifier and primary button held.
  let pressStart=null;
  const modifierHeld=event=>MAC?event.metaKey:event.ctrlKey;
  function configureFrom(settings) {
    holdKey=settings.holdKey;holdTrigger=settings.holdTrigger==='modifier'?'modifier':'letter';
    const origin=location.origin,exceptions=settings.holdExceptions || [];
    holdEnabled=!exceptions.includes(origin)&&(settings.holdScope==='all'||(settings.holdOrigins || []).includes(origin));
  }
  async function configure() {
    try{configureFrom(await request({type:'settings.get'}));}catch{holdEnabled=false;}
  }
  document.addEventListener('keydown',event=>{if(holdEnabled&&holdTrigger==='letter'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!editable(event)&&event.key.toLowerCase()===holdKey)held=true;},true);
  document.addEventListener('keyup',event=>{if(event.key.toLowerCase()===holdKey)held=false;},true);
  window.addEventListener('blur',()=>{held=false;pressStart=null;});
  document.addEventListener('pointerdown',event=>{
    pressStart=null;
    if(!holdEnabled||active||event.button!==0||!event.isPrimary||editable(event))return;
    if(holdTrigger==='letter'){if(held){event.preventDefault();event.stopImmediatePropagation();suppressNextClick();arm(event);}return;}
    if(modifierHeld(event)){const selection=getSelection();pressStart={x:event.clientX,y:event.clientY,pointerId:event.pointerId,selectionEmpty:!selection||selection.isCollapsed||!selection.rangeCount};}
  },true);
  document.addEventListener('pointermove',event=>{
    if(!pressStart||event.pointerId!==pressStart.pointerId)return;
    if(!(event.buttons&1)||!modifierHeld(event)||!holdEnabled||active){pressStart=null;return;}
    if(Math.hypot(event.clientX-pressStart.x,event.clientY-pressStart.y)<DRAG_THRESHOLD)return;
    const from=pressStart;pressStart=null;
    event.preventDefault();event.stopImmediatePropagation();
    if(from.selectionEmpty)getSelection()?.removeAllRanges();
    suppressNextClick();
    arm({button:0,clientX:from.x,clientY:from.y,pointerId:event.pointerId,preventDefault(){},stopImmediatePropagation(){}},{x:event.clientX,y:event.clientY});
  },true);
  const endPress=event=>{if(pressStart&&event.pointerId===pressStart.pointerId)pressStart=null;};
  document.addEventListener('pointerup',endPress,true);
  document.addEventListener('pointercancel',endPress,true);
  // Chrome starts dragging a link or image after a few pixels, before the selection threshold.
  // While a modifier press may still become a selection, that native drag would end it.
  document.addEventListener('dragstart',event=>{if(pressStart){event.preventDefault();}},true);
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='content.configure'){holdEnabled=!!message.enabled;holdKey=message.holdKey;holdTrigger=message.holdTrigger==='modifier'?'modifier':'letter';held=false;pressStart=null;}
    if(message?.type==='links.progress')active?.progress(message);
  });
  globalThis.__linkMeteor={scan,arm};configure();
})();
