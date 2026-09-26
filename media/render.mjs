// Renders a Link Meteor video timeline (media/videos/<id>.mjs) from recorded clips
// (media/record.mjs) into site/assets/video/<id>.mp4 plus WebVTT captions, a poster, a
// transcript (injected into site pages between <!-- transcript:<id> --> markers) and a
// production manifest in media/out/<id>.json.
//
// Usage: node media/render.mjs [demo|install ...] [--proof=1.5,8.2] [--crf=24] [--text-only]
// --text-only rewrites the WebVTT captions and page transcripts without encoding video.
// Requires an installed ffmpeg and Playwright Chromium; nothing is downloaded.
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {access, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {extname, normalize, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {renderMeteorFrames} from './lib/meteor-frames.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const root = resolve(import.meta.dirname, '..');
const rec = resolve(root, '.scratch/media/rec');
const introDir = resolve(root, '.scratch/media/intro');
const outDir = resolve(root, 'site/assets/video');
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const proof = args.find((a) => a.startsWith('--proof='))?.slice(8).split(',').map(Number);
const textOnly = args.includes('--text-only');
const crf = Number(args.find((a) => a.startsWith('--crf='))?.slice(6) || 24);
const files = {demo: 'demo.mjs', install: 'install.mjs'};

function parseTime(spec, marks, name) {
  if (typeof spec === 'number') return spec;
  const m = /^(.*?)([+-]\d+(?:\.\d+)?)?$/.exec(spec);
  if (!(m[1] in marks)) throw new Error(`${name}: unknown mark "${m[1]}"`);
  return marks[m[1]] + Number(m[2] || 0);
}
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const stamp = (s, vtt) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60; return vtt ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadClip(name) {
  const clip = JSON.parse(await readFile(resolve(rec, name, 'clip.json'), 'utf8'));
  const t0 = clip.started, marks = {}, markData = {}, downs = [];
  for (const e of clip.events) if (e.type === 'mark' && !(e.label in marks)) { marks[e.label] = e.t - t0; markData[e.label] = e; }
  const pointer = clip.events.filter((e) => e.type === 'pointer').map((e) => ({t: e.t - t0, x: e.x, y: e.y}));
  let open = null;
  for (const e of clip.events) { if (e.type === 'down') open = e.t - t0; if (e.type === 'up' && open !== null) { downs.push([open, e.t - t0]); open = null; } }
  return {clip, marks, markData, pointer, downs, frames: clip.frames.map((f) => ({src: `/.scratch/media/rec/${name}/${f.file}`, t: f.t - t0}))};
}
const pointerAt = (pointer, t) => { let p = pointer[0]; for (const q of pointer) if (q.t <= t) p = q; return p; };

async function resolveTimeline(tl) {
  try { await access(resolve(introDir, 'frames.json')); } catch { await renderMeteorFrames(root, introDir); }
  const art = Array.from({length: 90}, (_, i) => `/.scratch/media/intro/${String(i + 1).padStart(3, '0')}.jpg`);
  const scenes = [], cues = [], sources = [];
  let cursor = 0;
  for (const [i, spec] of tl.scenes.entries()) {
    const s = {...spec};
    if (spec.kind === 'clip') {
      const c = await loadClip(spec.clip); const T = (x) => parseTime(x, c.marks, spec.clip);
      // Numbers and file names in captions must match what the recording logged from the page.
      for (const x of spec.expect || []) {
        const got = c.markData[x.mark]; const value = got?.text ?? got?.file;
        if (value === undefined || (x.equals !== undefined && value !== x.equals) || (x.startsWith !== undefined && !value.startsWith(x.startsWith))) throw new Error(`${spec.clip}: mark ${x.mark} recorded ${JSON.stringify(value)}, caption expects ${JSON.stringify(x.equals ?? x.startsWith)}`);
      }
      Object.assign(s, {frames: c.frames, pointer: c.pointer, downs: c.downs, viewport: c.clip.viewport, from: T(spec.from), to: T(spec.to)});
      if ('armed' in c.marks) s.crosshair = [c.marks.armed, c.marks.released ?? 1e9];
      if (spec.keys) s.keys = {...spec.keys, t0: T(spec.keys.t0), t1: T(spec.keys.t1)};
      s.camera = (spec.camera || []).map((k) => { const t = T(k.t); const p = k.at ? pointerAt(c.pointer, T(k.at)) : null; return {t, zoom: k.zoom, cx: p ? p.x + (k.dx || 0) : k.cx, cy: p ? p.y + (k.dy || 0) : k.cy}; }).sort((a, b) => a.t - b.t);
      s.captions = (spec.captions || []).map((x) => ({...x, t0: T(x.t0), t1: T(x.t1)}));
      if (spec.still) s.still = {src: `/.scratch/media/rec/${spec.still}`, width: 2560, height: 1440};
      s.duration = s.to - s.from;
      sources.push({scene: i, clip: spec.clip, method: c.clip.mode === 'reconstruction' ? 'reconstruction' : 'recording', page: c.clip.page, version: c.clip.version, recordedAt: c.clip.recordedAt, profile: c.clip.profile || 'task-owned test profile', ...(spec.still ? {still: spec.still} : {})});
    } else {
      s.captions = (spec.captions || []).map((x) => ({...x}));
      if (spec.kind === 'card') { s.art = art; sources.push({scene: i, method: 'artwork', note: 'Approved README artwork with the README animation’s flowing light, rendered at full resolution'}); }
      if (spec.kind === 'illustration') sources.push({scene: i, method: 'illustration', note: `Schematic of ${spec.label}`});
      if (spec.kind === 'sheet') {
        // The sheet name and the text-only claim both come from the downloaded file itself.
        const py = 'import json,sys\nfrom openpyxl import load_workbook\nws=load_workbook(sys.argv[1]).active\nprint(json.dumps({"sheet":ws.title,"text":all(c.data_type=="s" for r in ws.iter_rows() for c in r if c.value is not None),"rows":[["" if c.value is None else str(c.value) for c in r] for r in ws.iter_rows()]}))';
        const book = JSON.parse(execFileSync('python3', ['-c', py, resolve(rec, spec.source)]).toString());
        s.rows = book.rows;
        s.sub = `Sheet “${book.sheet}”${book.text ? ' · every cell stored as text' : ''}`;
        sources.push({scene: i, method: 'file rendering', note: `Rows read with openpyxl from the workbook downloaded during recording (${spec.source})`, rows: s.rows.length - 1});
      }
    }
    s.start = i === 0 ? 0 : cursor - tl.fade; s.end = s.start + s.duration; cursor = s.end;
    scenes.push(s);
  }
  // Keep captions out of the crossfades so two scenes' captions never overlap on screen.
  scenes.forEach((s, i) => {
    const local = (abs) => (s.kind === 'clip' ? s.from + (abs - s.start) : abs - s.start);
    const toAbs = (t) => (s.kind === 'clip' ? s.start + (t - s.from) : s.start + t);
    const lo = s.start + (i > 0 ? tl.fade : 0), hi = s.end - (i < scenes.length - 1 ? tl.fade : 0);
    for (const c of s.captions) {
      const start = Math.max(lo, toAbs(c.t0)), end = Math.min(hi, toAbs(c.t1));
      Object.assign(c, {t0: local(start), t1: local(end), at: start});
      cues.push({start, end, text: (c.step ? `Step ${c.step}: ` : '') + strip(c.html || c.text)});
    }
  });
  return {fade: tl.fade, fps: tl.fps, duration: cursor, scenes, cues, sources};
}

function serve() {
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
  const server = createServer(async (req, res) => {
    const path = normalize(resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try { res.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream'}); res.end(await readFile(path)); } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// WebVTT captions beside the video, and the transcript between its markers in the site pages.
async function writeText(tl, r) {
  const vtt = 'WEBVTT\n\n' + r.cues.map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${c.text}\n`).join('\n');
  await writeFile(resolve(outDir, `${tl.id}.vtt`), vtt);
  const html = transcriptHtml(tl, r);
  for (const pageFile of ['site/index.html', 'site/install.html']) {
    const path = resolve(root, pageFile); let text = await readFile(path, 'utf8');
    const open = `<!-- transcript:${tl.id} -->`, close = `<!-- /transcript:${tl.id} -->`;
    const a = text.indexOf(open), b = text.indexOf(close);
    if (a >= 0 && b > a) { text = text.slice(0, a + open.length) + '\n          ' + html + '\n          ' + text.slice(b); await writeFile(path, text); }
  }
}

// One line per caption, each with its own time, after a "Picture" line describing the scene.
function transcriptHtml(tl, r) {
  const items = r.scenes.flatMap((s, i) => [
    `<li class="scene"><span class="t">${stamp(s.start)}</span><p><span class="tag">Picture</span> ${esc(tl.scenes[i].describe || '')}</p></li>`,
    ...(s.captions || []).map((c) => `<li><span class="t">${stamp(c.at)}</span><p>${esc((c.step ? `Step ${c.step}: ` : '') + strip(c.html || c.text))}</p></li>`),
  ]).join('\n            ');
  return `<ol class="transcript">\n            ${items}\n          </ol>`;
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch();
try {
  await mkdir(outDir, {recursive: true}); await mkdir(resolve(root, 'media/out'), {recursive: true});
  for (const key of names.length ? names : Object.keys(files)) {
    const tl = (await import(`./videos/${files[key]}`)).default;
    const r = await resolveTimeline(tl);
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
    page.on('pageerror', (e) => { throw e; });
    await page.goto(`${base}/media/compose/compose.html`);
    await page.evaluate((timeline) => window.compose.setup(timeline), r);
    if (proof) {
      const proofDir = resolve(root, '.scratch/media/proof'); await mkdir(proofDir, {recursive: true});
      for (const t of proof) { await page.evaluate((t) => window.compose.render(t), t); await page.screenshot({path: resolve(proofDir, `${tl.id}-${t}.jpg`), type: 'jpeg', quality: 85}); }
      console.log(JSON.stringify({proof: tl.id, times: proof, duration: +r.duration.toFixed(2), scenes: r.scenes.map((s) => [s.kind || s.clip || s.illustration, +s.start.toFixed(2), +s.end.toFixed(2)]), shortCaptions: r.cues.filter((c) => c.end - c.start < 2.2).map((c) => [+(c.end - c.start).toFixed(2), c.text])}));
      await page.close(); continue;
    }
    if (textOnly) { await writeText(tl, r); console.log(JSON.stringify({text: tl.id, captions: r.cues.length})); await page.close(); continue; }
    const mp4 = resolve(outDir, `${tl.id}.mp4`);
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(tl.fps), '-c:v', 'mjpeg', '-i', 'pipe:0', '-vf', 'scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', String(crf), '-profile:v', 'high', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', mp4], {stdio: ['pipe', 'inherit', 'inherit']});
    const done = once(ff, 'close');
    const frames = Math.round(r.duration * tl.fps), began = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.compose.render(t), f / tl.fps);
      if (!ff.stdin.write(await page.screenshot({type: 'jpeg', quality: 93}))) await once(ff.stdin, 'drain');
      if (f % 150 === 0) console.log(JSON.stringify({video: tl.id, frame: f, of: frames}));
    }
    ff.stdin.end(); const [code] = await done; if (code) throw new Error(`ffmpeg exited ${code}`);
    await page.evaluate((t) => window.compose.render(t), tl.poster);
    await page.screenshot({path: resolve(outDir, `${tl.id}-poster.jpg`), type: 'jpeg', quality: 86});
    await writeText(tl, r);
    const bytes = await readFile(mp4);
    const info = {id: tl.id, title: tl.title, file: `site/assets/video/${tl.id}.mp4`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), seconds: +r.duration.toFixed(2), fps: tl.fps, frames, size: '1920x1080', codec: 'H.264 High, yuv420p, no audio track', crf, renderedAt: new Date().toISOString(), renderSeconds: Math.round((Date.now() - began) / 1000), captions: r.cues.length, sources: r.sources};
    await writeFile(resolve(root, 'media/out', `${tl.id}.json`), JSON.stringify(info, null, 2) + '\n');
    console.log(JSON.stringify({video: tl.id, seconds: info.seconds, bytes: info.bytes, sha256: info.sha256.slice(0, 12), renderSeconds: info.renderSeconds}));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
