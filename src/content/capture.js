(() => {
  if (globalThis.__linkMeteor) return;
  const MAX_LINKS = 20000;
  const marker = 'data-link-meteor';
  let active = null, held = false, holdKey = 'z', holdEnabled = false;
  const normalize = value => String(value || '').replace(/\s+/gu,' ').trim();
  const intersect = (a,b) => ({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
  const positive = r => r.right > r.left && r.bottom > r.top;

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
      :host{color-scheme:light dark}*{box-sizing:border-box}button{font:600 13px/1.2 system-ui;border:1px solid #827d76;border-radius:7px;padding:10px 12px;background:#fff;color:#252522;cursor:pointer;min-height:38px}button:hover{background:#f1eee8}button:focus-visible{outline:3px solid #e7653c;outline-offset:2px}button:disabled{opacity:.5;cursor:default}.shield{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none}.rect{position:fixed;border:2px solid #ec683d;background:#ec683d14;pointer-events:none}.hit{position:fixed;border:1px solid #e05b31;background:#f8ab552f;pointer-events:none}.hint,.bar{position:fixed;pointer-events:auto;box-shadow:0 8px 35px #0003;border:1px solid #d4cdc2;background:#fffcf5;color:#252522;font:13px/1.5 system-ui;border-radius:12px;padding:12px 14px;max-width:calc(100vw - 24px)}.hint{top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px}.bar{right:14px;bottom:14px;width:420px;display:none}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.primary{background:#282824;color:#fff}.count{font-size:17px;font-weight:700}.status{font-size:12px;margin-top:6px;overflow-wrap:anywhere}.badge{position:fixed;pointer-events:none;background:#252522;color:white;border-radius:6px;padding:4px 8px;font:700 12px system-ui}.warning{color:#7b3e20} @media(prefers-color-scheme:dark){.hint,.bar{background:#242522;color:#f9f6ee;border-color:#57584f}button{background:#353730;color:#fff;border-color:#696b60}button:hover{background:#44473c}.primary{background:#ed8b64;color:#201f1d}.warning{color:#f5b995}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
      [hidden]{display:none!important}</style><div class="shield"></div><div class="hits"></div><div class="rect" hidden></div><div class="badge" hidden></div><div class="hint"><span>Drag a region to collect links · Scroll to extend · Esc to cancel</span><button class="cancel" aria-label="Cancel link selection">Cancel</button></div><div class="bar" role="dialog" aria-label="Captured links"><div class="count" aria-live="polite"></div><div class="warning"></div><div class="actions"><button class="copy primary">Copy text + URL</button><button class="add">Add to collection</button><button class="review">Review</button><button class="more">Add another region</button><button class="dismiss" aria-label="Close captured links">Close</button></div><div class="status" role="status" aria-live="polite"></div></div>`;
    document.documentElement.append(host);
    const $=selector=>shadow.querySelector(selector);
    const shield=$('.shield'), box=$('.rect'), badge=$('.badge'), hits=$('.hits');
    let dragging=false, start=null, pointer=null, frame=null, entries=[], selected=[], warnings=[],inaccessibleFrames=0,committed=false;
    const swept=new Map();
    const state={close};active=state;

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
      $('.warning').textContent=warnings.join(' ');for(const cls of ['copy','add','review','more'])$('.'+cls).disabled=!selected.length;
      if(!selected.length)$('.status').textContent='No links in this region. Close and select another area.';
      $('.copy').focus();
    });
    async function save(review=false){
      if(committed){if(review)await request({type:'ui.open'});return;}
      const result=await request({type:'capture.commit',links:selected.map(entry=>entry.link),inaccessibleFrames,review});committed=true;$('.add').disabled=true;$('.status').textContent=`Saved ${result.count} links to your active collection. ${result.warning || ''}`.trim();
    }
    function action(cls,fn){$('.'+cls).onclick=async()=>{const button=$('.'+cls);button.disabled=true;try{await fn();}catch(error){$('.status').textContent=String(error.message || error);}finally{if(host.isConnected)button.disabled=cls==='add'&&committed;}};}
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
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.linkMeteorState)configure();});
  globalThis.__linkMeteor={scan,arm};configure();
})();
