// The toolbar icon follows the theme (0.4.0): the mark is drawn with the theme's highlight and set
// with chrome.action.setIcon. Meteor sets the manifest's own icons, so it is the packaged icon exactly.
import {THEMES} from '../core/themes.js';
import {serial, readState} from './store.js';

// The mark's geometry at each size: assets/brand/icon-16.svg, and icon.svg (128 units) for 32 px.
const MARKS = {
  16: {scale: 1, tile: [0, 0, 16, 16, 4], trail: 'M8.2 3.9 L12.1 7.8 L3.2 13.6 Q2.4 12.8 3.2 12 Z', fade: [10.5, 5.5, 2.5, 13.5, 0.35], head: [10.4, 5.6, 2.9]},
  32: {scale: 0.25, tile: [6, 6, 116, 116, 30], trail: 'M71.3 34.1 L95.9 58.7 L29.9 102.1 Q25.9 98.1 29.9 94.1 Z', fade: [84, 44, 26, 102, 0.18], head: [83.6, 46.4, 17.4]},
};

// The dark tile, the trail fading from the head, and the head, in the theme's colors.
export function drawMark(size, theme) {
  const mark = MARKS[size], canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
  const scaled = context => { context.setTransform(mark.scale, 0, 0, mark.scale, 0, 0); return context; };
  // The trail fades toward its tail: filled solid, then masked by a gradient of opacity.
  const trail = new OffscreenCanvas(size, size), tctx = scaled(trail.getContext('2d'));
  tctx.fillStyle = theme.highlight; tctx.fill(new Path2D(mark.trail));
  const [x1, y1, x2, y2, tail] = mark.fade, fade = tctx.createLinearGradient(x1, y1, x2, y2);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, `rgba(0,0,0,${tail})`);
  tctx.globalCompositeOperation = 'destination-in'; tctx.fillStyle = fade; tctx.fillRect(0, 0, size / mark.scale, size / mark.scale);
  scaled(ctx).fillStyle = theme.light['mark-tile'];
  ctx.beginPath(); ctx.roundRect(...mark.tile.slice(0, 4), mark.tile[4]); ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(trail, 0, 0);
  scaled(ctx).fillStyle = theme.highlight;
  ctx.beginPath(); ctx.arc(...mark.head, 0, Math.PI * 2); ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

let iconQueue = Promise.resolve();
// Icons are set in the order themes were saved.
export function setThemeIcon(id) {
  if (!chrome.action?.setIcon) return iconQueue;
  const theme = THEMES[id] || THEMES.meteor;
  const set = () => theme.id === 'meteor' || typeof OffscreenCanvas !== 'function'
    ? chrome.action.setIcon({path: chrome.runtime.getManifest().action.default_icon})
    : chrome.action.setIcon({imageData: {16: drawMark(16, theme), 32: drawMark(32, theme)}});
  iconQueue = iconQueue.then(set, set).catch(() => {});
  return iconQueue;
}

// At startup and install: the saved theme's icon.
export async function syncIcon() {
  if (!chrome.action?.setIcon) return;
  const state = await serial(readState);
  await setThemeIcon(state.settings.theme);
}

// A saved change of theme, from the settings or a restored backup, changes the icon.
export function followThemeWrites(previous, next) {
  if (previous?.settings?.theme !== next?.settings?.theme) return setThemeIcon(next.settings.theme);
}
