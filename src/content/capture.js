(() => {
  if (globalThis.__linkMeteor) return;
  const MAX_LINKS = 20000;
  const marker = 'data-link-meteor';
  let active = null, held = false, holdKey = 'z', holdEnabled = false;
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

  function arm(startEvent) {
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
      .bar{right:16px;bottom:16px;width:400px;display:none;padding:14px;animation:rise .18s cubic-bezier(.22,1,.36,1)}
      .head{display:flex;align-items:flex-start;gap:10px}
      .titles{flex:1;min-width:0}
      .count{font-size:16px;font-weight:700;line-height:1.3;color:#fff;font-variant-numeric:tabular-nums}
      .dest{margin-top:1px;color:#a2a8b5;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dest b{color:#dfe3ea;font-weight:600}
      .preview{list-style:none;margin:12px 0 0;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);display:grid;gap:3px}
      .preview li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eef0f4;font-size:12.5px}
      .preview li.empty{color:#a2a8b5;font-style:italic}
      .preview li.more{color:#a2a8b5;font-size:12px}
      .warning{margin-top:10px;color:#f4c26a;font-size:12px;overflow-wrap:anywhere}
      .warning:empty,.status:empty,.preview:empty,.dest:empty{display:none}
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
      .status{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:#dfe3ea;overflow-wrap:anywhere}
      @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(max-width:460px){.bar{left:12px;right:12px;bottom:12px;width:auto}.hint span{display:none}}
      @media(prefers-reduced-motion:reduce){.bar{animation:none}*{transition:none!important}}
      @media(forced-colors:active){.panel,button{border:1px solid CanvasText}.hit,.rect{outline:2px solid Highlight}}
      [hidden]{display:none!important}</style><div class="shield"></div><div class="hits"></div><div class="rect" hidden></div><div class="badge" hidden></div><div class="panel hint">${mark('hint')}<div><strong>Drag across the links you want</strong> <span>· Scroll to extend · Esc to cancel</span></div><button class="cancel" aria-label="Cancel link selection">Cancel</button></div><div class="panel bar" role="dialog" aria-label="Captured links"><div class="head">${mark('bar')}<div class="titles"><div class="count" aria-live="polite"></div><div class="dest"></div></div><button class="dismiss icon" aria-label="Close captured links">${ICON_X}</button></div><ul class="preview" aria-label="First captured links"></ul><div class="warning"></div><div class="actions"><button class="copy primary">${ICON_COPY}Copy text + URL</button><button class="add">${ICON_PLUS}Add to collection</button><button class="review">${ICON_LIST}Review</button><button class="more">${ICON_REGION}Add another region</button></div><div class="status" role="status" aria-live="polite"></div></div>`;
    document.documentElement.append(host);
    const $=selector=>shadow.querySelector(selector);
    const shield=$('.shield'), box=$('.rect'), badge=$('.badge'), hits=$('.hits');
    let dragging=false, start=null, pointer=null, frame=null, entries=[], selected=[], warnings=[],inaccessibleFrames=0,committed=false,destination='',destinationRequest=0,saveInFlight=null;
    const swept=new Map();
    const state={close,refreshDestination};active=state;

    function close() {
      if(frame)cancelAnimationFrame(frame);document.removeEventListener('keydown',escape,true);host.remove();if(active===state)active=null;held=false;
    }
    function escape(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}
    document.addEventListener('keydown',escape,true);
    $('.cancel').onclick=close;$('.dismiss').onclick=close;

    function begin(event) {
      if(event.button!==0)return;
      event.preventDefault();event.stopImmediatePropagation();
      dragging=true;pointer={x:event.clientX,y:event.clientY};start={x:event.clientX+scrollX,y:event.clientY+scrollY};
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
    shield.addEventListener('pointerdown',begin);
    shield.addEventListener('pointermove',event=>{if(dragging){event.preventDefault();pointer={x:event.clientX,y:event.clientY};refresh();}});
    shield.addEventListener('wheel',event=>{if(!dragging)return;event.preventDefault();for(const entry of selected)swept.set(entry.element,entry);host.style.setProperty('visibility','hidden','important');let target=document.elementFromPoint(event.clientX,event.clientY);host.style.removeProperty('visibility');while(target&&target!==document.documentElement){const s=getComputedStyle(target);if(/(auto|scroll)/.test(s.overflowY)&&target.scrollHeight>target.clientHeight)break;target=target.parentElement;}if(target&&target!==document.documentElement)target.scrollBy(event.deltaX,event.deltaY);else window.scrollBy(event.deltaX,event.deltaY);refresh(true);},{passive:false});
    shield.addEventListener('pointercancel',close);
    shield.addEventListener('pointerup',event=>{
      if(!dragging)return;event.preventDefault();event.stopImmediatePropagation();dragging=false;if(frame)cancelAnimationFrame(frame);refresh(true);shield.releasePointerCapture?.(event.pointerId);shield.style.pointerEvents='none';box.hidden=true;badge.hidden=true;$('.hint').hidden=true;$('.bar').style.display='block';
      $('.count').textContent=`${selected.length} link${selected.length===1?'':'s'} selected`;
      renderPreview();
      $('.warning').textContent=warnings.join(' ');for(const cls of ['copy','add','review','more'])$('button.'+cls).disabled=!selected.length;
      if(!selected.length)$('.status').textContent='No links in this region. Close and select another area.';
      $('.copy').focus();
    });
    function renderDest() {
      const dest=$('.dest');dest.replaceChildren();
      if(!destination)return;
      const name=document.createElement('b');name.textContent=destination;
      dest.append(committed?'Saved to ':'Adds to ',name);dest.title=destination;
    }
    function renderPreview() {
      const list=$('.preview');list.replaceChildren();
      for(const {link} of selected.slice(0,3)){
        const item=document.createElement('li');
        item.textContent=link.anchorText || (link.accessibleLabel?`No anchor text (labeled “${link.accessibleLabel}”)`:'No anchor text');
        if(!link.anchorText)item.className='empty';
        item.title=link.url;list.append(item);
      }
      if(selected.length>3){const more=document.createElement('li');more.className='more';more.textContent=`and ${selected.length-3} more`;list.append(more);}
    }
    async function refreshDestination() {
      const sequence=++destinationRequest;
      try {
        const collection=await request({type:'collection.active'});
        if(active!==state || committed || sequence!==destinationRequest)return;
        destination=collection?.name || '';renderDest();
      } catch { /* Saving still reports the actual destination from its receipt. */ }
    }
    refreshDestination();
    async function save(review=false){
      if(saveInFlight){await saveInFlight;if(review)await request({type:'ui.open'});return;}
      if(committed){if(review)await request({type:'ui.open'});return;}
      saveInFlight=(async()=>{
        const result=await request({type:'capture.commit',links:selected.map(entry=>entry.link),inaccessibleFrames,review});
        committed=true;destination=result.state.collections.find(c=>c.id===result.state.activeCollectionId)?.name || '';
        $('.add').disabled=true;$('.add').innerHTML=`${ICON_CHECK}Added`;renderDest();
        $('.status').textContent=`Saved ${result.count} link${result.count===1?'':'s'} to ${destination?`“${destination}”`:'your active collection'}. ${result.warning || ''}`.trim();
      })();
      try {await saveInFlight;} finally {saveInFlight=null;}
    }
    function action(cls,fn){$('button.'+cls).onclick=async()=>{const button=$('button.'+cls);button.disabled=true;try{await fn();}catch(error){$('.status').textContent=String(error.message || error);}finally{if(host.isConnected)button.disabled=cls==='add'&&committed;}};}
    action('add',()=>save());action('review',()=>save(true));action('more',async()=>{await save();arm();});
    action('copy',async()=>{
      const {text}=await request({type:'capture.copy',links:selected.map(entry=>entry.link)});
      let copied=false;
      try{await navigator.clipboard.writeText(text);copied=true;}catch{
        const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;left:0;top:0;opacity:0';shadow.append(area);area.focus();area.select();copied=document.execCommand('copy');area.remove();
      }
      $('.status').textContent=copied?'Copied anchor text and URL as two spreadsheet columns.':'Clipboard access was blocked. Review the links and use Export instead.';
    });
    if(startEvent)begin(startEvent);
    return {armed:true};
  }

  async function configure() {
    try{const settings=await request({type:'settings.get'});holdKey=settings.holdKey;holdEnabled=settings.holdOrigins.includes(location.origin);}catch{holdEnabled=false;}
  }
  document.addEventListener('keydown',event=>{if(holdEnabled&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!editable(event)&&event.key.toLowerCase()===holdKey)held=true;},true);
  document.addEventListener('keyup',event=>{if(event.key.toLowerCase()===holdKey)held=false;},true);
  window.addEventListener('blur',()=>{held=false;});
  document.addEventListener('pointerdown',event=>{if(held&&holdEnabled&&!active&&event.button===0&&!editable(event)){event.preventDefault();event.stopImmediatePropagation();arm(event);}},true);
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='content.configure'){holdEnabled=!!message.enabled;holdKey=message.holdKey;held=false;}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.linkMeteorState){configure();active?.refreshDestination();}});
  globalThis.__linkMeteor={scan,arm};configure();
})();
