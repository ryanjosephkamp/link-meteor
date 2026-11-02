// Deterministic frame renderer for the Link Meteor videos. media/render.mjs loads a resolved
// timeline (see media/videos/*.mjs), then calls render(t) for every output frame and screenshots
// the 1920x1080 stage. Recorded clips are shown frame-accurately; the pointer is drawn from the
// recorder's logged synthetic pointer positions.
import {illustration} from './illustrations.js';

const stage = document.getElementById('stage');
const WIDE = {x: 200, y: 64, w: 1520, h: 855};
const PANEL_STILL = {x: 200, y: 64, w: 1010, h: 855};
const PANEL = {x: 1245, y: 64, w: 475, h: 855};
const ARROW = `<svg viewBox="0 0 44 44" width="44" height="44"><path d="M9 5 L9 36 L17 28.6 L22.4 40.2 L28 37.6 L22.7 26.2 L33.6 26 Z" fill="#fff" stroke="#10131b" stroke-width="2.6" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 44 44" width="44" height="44"><g stroke="#10131b" stroke-width="6" stroke-linecap="round"><path d="M22 6v12M22 26v12M6 22h12M26 22h12"/></g><g stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M22 6v12M22 26v12M6 22h12M26 22h12"/></g></svg>`;
const MARK = `<svg class="mark" viewBox="0 0 24 24"><defs><linearGradient id="mk" x1="15.7" y1="8.3" x2="4" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c3f344"/><stop offset="1" stop-color="#c3f344" stop-opacity=".2"/></linearGradient></defs><rect width="24" height="24" rx="6.5" fill="#1b2336"/><g transform="translate(12 12) scale(.78) translate(-12 -12)"><path d="M13.2 4.6 19.4 10.8 4.6 20.4Q3.6 19.4 4.6 18.4Z" fill="url(#mk)"/><circle cx="16.3" cy="7.7" r="4.4" fill="#c3f344"/></g></svg>`;

const el = (tag, className, html) => { const n = document.createElement(tag); if (className) n.className = className; if (html !== undefined) n.innerHTML = html; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => x * x * (3 - 2 * x);
const easeIO = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const pending = new Set();
function setSrc(img, src) {
  if (img.dataset.src === src) return;
  img.dataset.src = src; img.src = src;
  const p = img.decode().catch(() => {}); pending.add(p); p.finally(() => pending.delete(p));
}
function fadeAt(t, t0, t1, f = .25) { if (t < t0 || t > t1) return 0; return Math.min(1, (t - t0) / f, (t1 - t) / f); }
function lastIndex(list, t, key = 't') { let lo = 0, hi = list.length - 1, ans = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid][key] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; }

function captionNodes(scene, parent) {
  return (scene.captions || []).map((c) => {
    const n = el('div', 'caption');
    if (c.step) n.append(el('div', 'step', String(c.step)));
    n.append(el('div', 'text', c.html || c.text));
    parent.append(n); return {n, c};
  });
}

function buildClip(scene) {
  const root = el('div', 'scene');
  const box = scene.layout === 'panel' ? PANEL : WIDE;
  root.append(Object.assign(el('div', 'label', `<span class="dot"></span>${scene.label}`), {style: `left:${box.x}px`}));
  if (scene.layout === 'panel' && scene.still) {
    const s = el('div', 'still'); Object.assign(s.style, {left: `${PANEL_STILL.x}px`, top: `${PANEL_STILL.y}px`, width: `${PANEL_STILL.w}px`, height: `${PANEL_STILL.h}px`});
    const img = el('img'); const scale = PANEL_STILL.h / scene.still.height; Object.assign(img.style, {width: `${scene.still.width * scale}px`, height: `${PANEL_STILL.h}px`});
    img.src = scene.still.src; s.append(img); root.append(s);
    root.append(Object.assign(el('div', 'label', `<span class="dot" style="background:#a9b0bd;box-shadow:none"></span>${scene.stillLabel || ''}`), {style: `left:${PANEL_STILL.x}px`}));
  }
  if (scene.tag) root.append(el('div', 'tag', scene.tag));
  const frame = el('div', 'frame'); Object.assign(frame.style, {left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`});
  const layer = el('div', 'layer'); Object.assign(layer.style, {width: `${scene.viewport.width}px`, height: `${scene.viewport.height}px`});
  const img = el('img'); layer.append(img); frame.append(layer); root.append(frame);
  const ripples = [0, 1].map(() => { const r = el('div', 'ripple'); root.append(r); return r; });
  const cursor = el('div', 'cursor'); root.append(cursor);
  let keys = null;
  if (scene.keys) {
    keys = el('div', 'keys', scene.keys.caps.map((k) => `<kbd>${k}</kbd>`).join('<span class="plus">+</span>') + (scene.keys.note ? `<span class="note">${scene.keys.note}</span>` : ''));
    // Lower-left inside the frame, clear of the extension's hint bar at the top of the page.
    Object.assign(keys.style, {left: `${box.x + 34}px`, bottom: `${1080 - (box.y + box.h) + 34}px`}); root.append(keys);
  }
  const caps = captionNodes(scene, root);
  stage.append(root);
  let cursorKind = '';
  return (t) => {
    const ct = scene.from + (t - scene.start) * (scene.speed || 1);
    setSrc(img, scene.frames[lastIndex(scene.frames, ct)].src);
    // Camera
    const cam = scene.camera, s0 = box.w / scene.viewport.width;
    let z = 1, cx = scene.viewport.width / 2, cy = scene.viewport.height / 2;
    if (cam?.length) {
      const i = lastIndex(cam, ct), a = cam[i], b = cam[Math.min(i + 1, cam.length - 1)];
      const k = b.t > a.t ? easeIO(clamp((ct - a.t) / (b.t - a.t), 0, 1)) : 0;
      z = a.zoom + (b.zoom - a.zoom) * k; cx = a.cx + (b.cx - a.cx) * k; cy = a.cy + (b.cy - a.cy) * k;
    }
    const S = s0 * z, vw = scene.viewport.width, vh = scene.viewport.height;
    const tx = clamp(box.w / 2 - cx * S, box.w - vw * S, 0), ty = clamp(box.h / 2 - cy * S, box.h - vh * S, 0);
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${S})`;
    // Pointer
    const pts = scene.pointer;
    if (pts?.length) {
      const i = lastIndex(pts, ct), a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      const k = b.t > a.t && ct > a.t ? clamp((ct - a.t) / (b.t - a.t), 0, 1) : 0;
      const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
      const sx = box.x + tx + px * S, sy = box.y + ty + py * S;
      const crosshair = scene.crosshair && ct >= scene.crosshair[0] && ct <= scene.crosshair[1];
      const kind = crosshair ? 'cross' : 'arrow';
      if (kind !== cursorKind) { cursor.innerHTML = kind === 'cross' ? CROSS : ARROW; cursorKind = kind; }
      const down = (scene.downs || []).some(([d0, d1]) => ct >= d0 && ct <= d1);
      const inside = sx >= box.x - 4 && sx <= box.x + box.w && sy >= box.y - 4 && sy <= box.y + box.h;
      cursor.style.opacity = inside ? 1 : 0;
      cursor.style.transform = kind === 'cross' ? `translate(${sx - 22}px, ${sy - 22}px) scale(${down ? .9 : 1})` : `translate(${sx - 9}px, ${sy - 5}px) scale(${down ? .88 : 1})`;
      const recent = (scene.downs || []).filter(([d0]) => ct >= d0 && ct - d0 < .6).slice(-2);
      ripples.forEach((r, j) => {
        const d = recent[j]; if (!d) { r.style.opacity = 0; return; }
        const age = (ct - d[0]) / .6, q = scene.pointer[lastIndex(scene.pointer, d[0])];
        const rx = box.x + tx + q.x * S, ry = box.y + ty + q.y * S;
        r.style.opacity = String((1 - age) * .9); r.style.transform = `translate(${rx}px, ${ry}px) scale(${1 + age * 3})`;
      });
    }
    if (keys) keys.style.opacity = String(fadeAt(ct, scene.keys.t0, scene.keys.t1, .2));
    for (const {n, c} of caps) n.style.opacity = String(fadeAt(ct, c.t0, c.t1));
  };
}

function buildCard(scene) {
  const root = el('div', 'scene');
  if (scene.variant === 'intro') {
    const art = el('div', 'art'); const img = el('img'); art.append(img); root.append(art);
    if (scene.kicker) root.append(el('div', 'card-text kicker', scene.kicker));
    root.append(el('div', 'card-text tagline', scene.tagline || ''));
    stage.append(root);
    const tag = root.querySelector('.tagline'), kicker = root.querySelector('.kicker');
    return (t) => {
      const lt = t - scene.start;
      setSrc(img, scene.art[Math.floor(lt * 30) % scene.art.length]);
      tag.style.opacity = String(smooth(clamp((lt - .5) / .6, 0, 1)));
      if (kicker) kicker.style.opacity = String(smooth(clamp((lt - .2) / .6, 0, 1)));
    };
  }
  const img = el('img', 'outro-art'); root.append(img);
  const box = el('div', 'outro', `${MARK}<h2>${scene.title}</h2><ul class="promise">${scene.promises.map((p) => `<li>${p}</li>`).join('')}</ul><div class="url">${scene.url}</div><div class="by">${scene.by}</div>`);
  root.append(box); stage.append(root);
  return (t) => { const lt = t - scene.start; setSrc(img, scene.art[Math.floor(lt * 30) % scene.art.length]); };
}

function buildSheet(scene) {
  const root = el('div', 'scene');
  root.append(Object.assign(el('div', 'label', `<span class="dot"></span>${scene.label}`), {style: `left:${WIDE.x}px`}));
  const wrap = el('div', 'sheet-wrap');
  const letters = ['', 'A', 'B'];
  const rows = scene.rows.map((r, i) => `<tr class="${i === 0 ? 'head' : ''}${scene.highlight === i ? ' hl' : ''}"><td class="n">${i + 1}</td>${r.map((v, j) => `<td class="${j === 1 ? 'url' : ''}${v === '' ? ' nil' : ''}">${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('');
  wrap.innerHTML = `<div class="sheet-bar"><span class="file">XLSX</span>${scene.file}<span class="sub">${scene.sub || ''}</span></div><table class="sheet"><colgroup><col style="width:70px"><col style="width:40%"><col></colgroup><tr>${letters.map((l) => `<th>${l}</th>`).join('')}</tr>${rows}</table>`;
  root.append(wrap);
  const caps = captionNodes(scene, root); stage.append(root);
  return (t) => { const lt = t - scene.start; for (const {n, c} of caps) n.style.opacity = String(fadeAt(lt, c.t0, c.t1)); };
}

function buildIllustration(scene) {
  const root = el('div', 'scene');
  root.append(Object.assign(el('div', 'label', `<span class="dot"></span>${scene.label}`), {style: `left:${WIDE.x}px`}));
  root.append(el('div', 'tag', 'Illustration'));
  const box = el('div', 'ill'); root.append(box);
  const draw = illustration(scene.illustration, box, scene);
  const caps = captionNodes(scene, root); stage.append(root);
  return (t) => { const lt = t - scene.start; draw(lt, scene.end - scene.start); for (const {n, c} of caps) n.style.opacity = String(fadeAt(lt, c.t0, c.t1)); };
}

let scenes = [], updaters = [], fade = .4;
window.compose = {
  async setup(timeline) {
    fade = timeline.fade; scenes = timeline.scenes; stage.replaceChildren();
    updaters = scenes.map((s) => ({clip: buildClip, card: buildCard, sheet: buildSheet, illustration: buildIllustration})[s.kind](s));
    await document.fonts.ready;
    return {scenes: scenes.length};
  },
  async render(t) {
    scenes.forEach((s, i) => {
      const root = stage.children[i];
      if (t < s.start - 1e-6 || t > s.end + 1e-6) { root.style.opacity = 0; root.style.visibility = 'hidden'; return; }
      const fin = i === 0 ? 1 : clamp((t - s.start) / fade, 0, 1), fout = i === scenes.length - 1 ? 1 : clamp((s.end - t) / fade, 0, 1);
      root.style.visibility = 'visible'; root.style.opacity = String(Math.min(fin, fout));
      updaters[i](t);
    });
    await Promise.all([...pending]);
    return true;
  },
};
