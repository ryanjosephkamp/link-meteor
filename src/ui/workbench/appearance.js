// Appearance (0.4.0): the workbench's theme and light or dark scheme, and the Appearance section
// in the rail. The token block from themeCss fully replaces the stylesheet's own values, and the
// last theme and scheme are cached in localStorage so the next first paint uses them.
import { THEME_IDS, THEMES, themeCss } from '../../core/themes.js';
import { $, node, icon, SVG_NS } from './helpers.js';
import { ui, action, mutate } from './state.js';

const CACHE_KEY = 'linkMeteorTheme';
const APPEARANCES = ['system', 'light', 'dark'];
const systemDark = matchMedia('(prefers-color-scheme: dark)');
// What is shown now: the saved choice once state has loaded, the cached one before.
const current = { theme: 'meteor', appearance: 'system' };
let applied = '';
// A choice being saved, shown in the meantime so a render from an earlier save doesn't flip it back.
let draft = null, saving = 0;

const schemeFor = (appearance) => (appearance === 'dark' || (appearance !== 'light' && systemDark.matches) ? 'dark' : 'light');

// Sets the token block and data-theme and data-scheme on <html>, and remembers them for next time.
function apply(theme, appearance) {
  current.theme = THEMES[theme] ? theme : 'meteor';
  current.appearance = APPEARANCES.includes(appearance) ? appearance : 'system';
  const scheme = schemeFor(current.appearance);
  const key = `${current.theme} ${current.appearance} ${scheme}`;
  if (key === applied) return;
  applied = key;
  let style = document.getElementById('theme');
  if (!style) { style = document.createElement('style'); style.id = 'theme'; document.head.append(style); }
  style.textContent = themeCss(current.theme, scheme);
  document.documentElement.dataset.theme = current.theme;
  document.documentElement.dataset.scheme = scheme;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: current.theme, scheme, appearance: current.appearance })); } catch { /* the next start shows Meteor until state loads */ }
}

// Before first paint: the cached theme and scheme. System follows the computer's setting from here on.
export function bootTheme() {
  let cached = {};
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { /* no cache yet */ }
  apply(cached.theme, cached.appearance || cached.scheme);
  systemDark.addEventListener('change', () => apply(current.theme, current.appearance));
}

// A small meteor on its theme's tile, like the toolbar icon.
function swatch(theme) {
  const part = (tag, attributes, fill) => {
    const item = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, value);
    if (fill) item.style.fill = fill;
    return item;
  };
  const svg = part('svg', { class: 'theme-swatch', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  const mark = part('g', { transform: 'translate(12 12) scale(.78) translate(-12 -12)' });
  mark.append(part('path', { d: 'M13.2 4.6 19.4 10.8 4.6 20.4Q3.6 19.4 4.6 18.4Z', 'fill-opacity': '.45' }, theme.swatch), part('circle', { cx: '16.3', cy: '7.7', r: '4.4' }, theme.swatch));
  svg.append(part('rect', { width: '24', height: '24', rx: '6.5' }, theme.light['mark-tile']), mark);
  return svg;
}

export function renderAppearance() {
  const { theme, appearance } = { ...(ui.state?.settings || current), ...draft };
  apply(theme, appearance);
  for (const input of document.querySelectorAll('input[name="theme"]')) input.checked = input.value === current.theme;
  for (const input of document.querySelectorAll('input[name="appearance"]')) input.checked = input.value === current.appearance;
  $('theme-blurb').textContent = `${THEMES[current.theme].name}: ${THEMES[current.theme].blurb}`;
}

// Shows the choice at once, then saves it. A failed save shows the saved choice again.
async function save(patch) {
  const mine = ++saving;
  draft = { ...draft, ...patch };
  renderAppearance();
  try { await mutate({ type: 'settings.update', patch }); }
  finally { if (mine === saving) draft = null; renderAppearance(); }
}

export function bindAppearance() {
  $('theme-picker').replaceChildren(...THEME_IDS.map((id) => {
    const choice = node('label', 'theme-choice');
    const input = node('input');
    input.type = 'radio'; input.name = 'theme'; input.value = id;
    input.addEventListener('change', () => { if (input.checked) action(() => save({ theme: id })); });
    const mark = node('span', 'theme-mark');
    mark.append(swatch(THEMES[id]), icon('i-check', 'icon theme-check'));
    choice.append(input, mark, node('span', 'theme-name', THEMES[id].name));
    return choice;
  }));
  for (const input of document.querySelectorAll('input[name="appearance"]')) {
    input.addEventListener('change', () => { if (input.checked) action(() => save({ appearance: input.value })); });
  }
  renderAppearance();
}
