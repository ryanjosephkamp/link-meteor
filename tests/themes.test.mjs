// Themes (0.4.0): every theme is complete, Meteor is exactly today's look, every theme's text
// colors meet WCAG AA (4.5:1) against the grounds they sit on, computed from the color values, and
// they stay readable under protanopia, deuteranopia and tritanopia simulations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { THEME_IDS, THEMES, WORKBENCH_TOKENS, CARD_ROLES, themeCss, cardVars, cardTheme } from '../src/core/themes.js';
import { reduceState, createState } from '../src/core/model.js';

const root = resolve(import.meta.dirname, '..');

// CSS color text (oklch(), #hex, rgba()) to sRGB 0..1, clipped to the gamut as browsers show it.
function srgb(color) {
  let m;
  if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color))) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  if ((m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color))) return [m[1], m[2], m[3]].map((v) => Number(v) / 255);
  if ((m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color))) {
    const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
    const a = C * Math.cos(H), b = C * Math.sin(H);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
    return linear.map((v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
  }
  throw new Error(`Unreadable color ${color}`);
}
const linear = (color) => srgb(color).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const relative = (rgb) => rgb.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrastOf = (a, b) => { const [x, y] = [relative(a), relative(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const ratio = (fore, back) => contrastOf(linear(fore), linear(back));

// Text on the grounds it sits on: the workbench's tokens and the on-page card's roles.
function textPairs(id, scheme) {
  const t = THEMES[id][scheme], c = THEMES[id].card[scheme], pairs = [];
  for (const ground of ['bg', 'surface']) {
    for (const text of ['ink', 'ink-2', 'muted', 'accent-text', 'danger']) pairs.push([`${text} on ${ground}`, t[text], t[ground]]);
  }
  pairs.push(['muted on sunken', t.muted, t.sunken], ['ink on accent-wash', t.ink, t['accent-wash']], ['on-accent on accent', t['on-accent'], t.accent]);
  for (const text of ['strong', 'ink', 'soft', 'muted', 'warn', 'link']) pairs.push([`card ${text}`, c[text], c.ground]);
  pairs.push(['card on-accent', c['on-accent'], c.accent]);
  return pairs;
}

test('every theme has every workbench token and card role in both schemes', () => {
  assert.deepEqual(Object.keys(THEMES), [...THEME_IDS]);
  for (const id of THEME_IDS) for (const scheme of ['light', 'dark']) {
    assert.deepEqual(WORKBENCH_TOKENS.filter((key) => !THEMES[id][scheme][key]), [], `${id} ${scheme} tokens`);
    assert.deepEqual(CARD_ROLES.filter((role) => !THEMES[id].card[scheme][role]), [], `${id} ${scheme} card roles`);
    const css = themeCss(id, scheme);
    for (const key of WORKBENCH_TOKENS) assert.ok(css.includes(`--${key}:`), `${id} ${scheme} css has --${key}`);
    const vars = cardVars(id, scheme);
    for (const role of CARD_ROLES) assert.ok(vars[`--k-${role}`], `${id} ${scheme} card var ${role}`);
    assert.equal(vars['color-scheme'], scheme);
  }
  assert.equal(cardTheme('nope', 'system').theme, 'meteor', 'an unknown theme falls back to Meteor');
});

test('Meteor is exactly today’s workbench tokens and card colors', async () => {
  const css = await readFile(resolve(root, 'src/ui/workbench.css'), 'utf8');
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
  const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
  const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = { ...light, ...tokens(darkBlock.slice(0, darkBlock.indexOf('\n}\n'))) };
  for (const key of WORKBENCH_TOKENS) {
    assert.equal(THEMES.meteor.light[key], light[key], `light --${key}`);
    assert.equal(THEMES.meteor.dark[key], dark[key], `dark --${key}`);
  }
  // The card's built-in defaults in the page script are Meteor's dark card, value for value.
  const script = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');
  const host = tokens(script.slice(script.indexOf(':host{'), script.indexOf('}', script.indexOf(':host{'))).replace(/;/g, ';\n').replace(':host{', ' ') + ';');
  const meteor = cardVars('meteor', 'dark');
  for (const [key, value] of Object.entries(host)) assert.equal(meteor[`--${key}`], value, `card --${key}`);
  assert.equal(Object.keys(host).length, CARD_ROLES.length + 4, 'every role, plus highlight, edge and two shadows');
});

test('every theme’s text meets 4.5:1 on its grounds, in both schemes', () => {
  const low = [];
  const check = (id, scheme, name, fore, back) => { const r = ratio(fore, back); if (r < 4.5) low.push(`${id} ${scheme} ${name} ${r.toFixed(2)}`); };
  for (const id of THEME_IDS) for (const scheme of ['light', 'dark']) {
    for (const [name, fore, back] of textPairs(id, scheme)) check(id, scheme, name, fore, back);
  }
  assert.deepEqual(low, []);
});

// Color-vision check. Method:
// - Each color becomes linear sRGB (clipped to the gamut, as browsers show it), is multiplied by
//   the Machado, Oliveira and Fernandes (2009) matrix for protanopia, deuteranopia or tritanopia
//   at severity 1.0, and is clipped to 0..1 again.
// - Text pairs must keep WCAG contrast of at least 4.5:1 in every simulation.
// - Two colors are distinguishable when their OKLab distance is at least 0.08, or their
//   luminance contrast is at least 1.5:1 (either is enough).
// - The highlight (selection box and matched links) must be distinguishable from a white and a
//   near-black page ground, and the accent fill from danger, in typical vision and every simulation.
const VISIONS = {
  typical: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (color, matrix) => { const rgb = linear(color); return matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))); };
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const distance = (a, b) => { const [p, q] = [oklab(a), oklab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const distinguishable = (a, b) => distance(a, b) >= 0.08 || contrastOf(a, b) >= 1.5;
const PAGE_GROUNDS = { white: '#ffffff', 'near-black': '#121212' };

test('the Machado matrices keep white white and gray gray', () => {
  for (const [vision, matrix] of Object.entries(VISIONS)) {
    for (const gray of ['#ffffff', '#777777']) assert.ok(distance(simulate(gray, matrix), linear(gray)) < 0.002, `${vision} ${gray}`);
  }
  // A red and an olive that typical vision tells apart by hue merge under deuteranopia.
  assert.ok(distance(simulate('#e05545', VISIONS.typical), simulate('#8c8c20', VISIONS.typical)) > 0.15);
  assert.ok(distance(simulate('#e05545', VISIONS.deuteranopia), simulate('#8c8c20', VISIONS.deuteranopia)) < 0.05);
});

test('every theme keeps text, highlight and accent readable under color-vision simulations', () => {
  const problems = [], lowest = { text: 99, highlight: 99, accent: 99 };
  for (const id of THEME_IDS) for (const scheme of ['light', 'dark']) for (const [vision, matrix] of Object.entries(VISIONS)) {
    const t = THEMES[id][scheme], at = `${id} ${scheme} ${vision}`;
    for (const [name, fore, back] of textPairs(id, scheme)) {
      const r = contrastOf(simulate(fore, matrix), simulate(back, matrix));
      lowest.text = Math.min(lowest.text, r);
      if (r < 4.5) problems.push(`${at}: ${name} ${r.toFixed(2)}:1`);
    }
    const highlight = simulate(THEMES[id].highlight, matrix);
    for (const [ground, color] of Object.entries(PAGE_GROUNDS)) {
      const page = simulate(color, matrix);
      lowest.highlight = Math.min(lowest.highlight, distance(highlight, page));
      if (!distinguishable(highlight, page)) problems.push(`${at}: highlight on a ${ground} page, distance ${distance(highlight, page).toFixed(3)}, ${contrastOf(highlight, page).toFixed(2)}:1`);
    }
    const accent = simulate(t.accent, matrix), danger = simulate(t.danger, matrix);
    lowest.accent = Math.min(lowest.accent, Math.max(distance(accent, danger) / 0.08, contrastOf(accent, danger) / 1.5));
    if (!distinguishable(accent, danger)) problems.push(`${at}: accent and danger, distance ${distance(accent, danger).toFixed(3)}, ${contrastOf(accent, danger).toFixed(2)}:1`);
  }
  assert.deepEqual(problems, []);
  assert.ok(lowest.text >= 4.5 && lowest.highlight >= 0.08 && lowest.accent >= 1, JSON.stringify(lowest));
});

// The website's theme tokens, derived from the same palettes. Meteor is the site's own :root. The
// hued themes and Graphite keep the site's lightness steps, tinted toward the theme's neutral hue
// (read from its ink token), with the accent family from the theme. High contrast uses its tokens.
const SITE_STEPS = {
  night: { night: [0.2, 0.035], 'night-2': [0.245, 0.04], 'night-3': [0.29, 0.04], 'night-line': [0.36, 0.035], 'night-ink': [0.96, 0.008], 'night-muted': [0.78, 0.02] },
  light: { paper: [0.985, 0.004], 'paper-2': [0.962, 0.007], ink: [0.23, 0.03], 'ink-2': [0.36, 0.03], muted: [0.48, 0.024], line: [0.9, 0.01], 'line-strong': [0.82, 0.014] },
  dark: { paper: [0.155, 0.016], 'paper-2': [0.19, 0.02], card: [0.215, 0.022], ink: [0.955, 0.007], 'ink-2': [0.86, 0.012], muted: [0.74, 0.02], line: [0.31, 0.022], 'line-strong': [0.42, 0.025] },
};
const parts = (color) => /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color).slice(1).map(Number);
const oklchText = (l, c, h, alpha) => `oklch(${+l.toFixed(4)} ${+c.toFixed(4)} ${c ? +h.toFixed(2) : 0}${alpha ? ` / ${alpha}` : ''})`;
function siteTokens(id, scheme) {
  const theme = THEMES[id], t = theme[scheme], [fl, fc, fh] = parts(theme.dark.accent);
  const accent = { lime: theme.dark.accent, 'lime-hover': theme.dark['accent-hover'], 'lime-deep': t['accent-text'], 'lime-mark': oklchText(fl, fc, fh, scheme === 'dark' ? 0.32 : 0.55), 'lime-edge': theme.edge, 'logo-head': theme.highlight, warn: t.warn, danger: t.danger };
  if (id === 'contrast') {
    const d = theme.dark;
    return { night: d.bg, 'night-2': d.surface, 'night-3': d.hover, 'night-line': d.line, 'night-ink': d.ink, 'night-muted': d.muted, paper: t.bg, 'paper-2': t.sunken, card: t.surface, ink: t.ink, 'ink-2': t['ink-2'], muted: t.muted, line: t.line, 'line-strong': t['line-strong'], ...accent, 'lime-wash': t['accent-wash'] };
  }
  const [, chroma, hue] = parts(theme.light.ink), scale = chroma / 0.03;
  const steps = { ...SITE_STEPS.night, ...(scheme === 'light' ? { ...SITE_STEPS.light, card: [1, 0] } : SITE_STEPS.dark) };
  const neutrals = Object.fromEntries(Object.entries(steps).map(([key, [l, c]]) => [key, oklchText(l, c * scale, hue)]));
  return { ...neutrals, ...accent, 'lime-wash': scheme === 'dark' ? oklchText(0.27, fc * 0.25, fh + 4) : oklchText(0.955, fc * 0.3, fh - 2) };
}
function siteThemeCss() {
  const block = (id, scheme, indent) => `${indent}:root[data-theme="${id}"] { ${Object.entries(siteTokens(id, scheme)).map(([key, value]) => `--${key}: ${value};`).join(' ')} }`;
  const ids = THEME_IDS.filter((id) => id !== 'meteor');
  return ['/* Themes (0.4.0): generated from src/core/themes.js, and checked by tests/themes.test.mjs. Meteor is :root above. */', ...ids.map((id) => block(id, 'light', '')), '@media (prefers-color-scheme: dark) {', ...ids.map((id) => block(id, 'dark', '  ')), '}', '/* End of themes */'].join('\n');
}

test('the website’s theme tokens match the palettes', async () => {
  const css = await readFile(resolve(root, 'site/assets/css/site.css'), 'utf8');
  const start = css.indexOf('/* Themes (0.4.0)'), end = css.indexOf('/* End of themes */');
  const expected = siteThemeCss(), actual = start < 0 || end < 0 ? '' : css.slice(start, end + '/* End of themes */'.length);
  if (actual !== expected) {
    await mkdir(resolve(root, '.scratch'), { recursive: true });
    await writeFile(resolve(root, '.scratch/site-themes.css'), expected + '\n');
  }
  assert.ok(actual === expected, 'site/assets/css/site.css has stale theme tokens: replace its Themes block with .scratch/site-themes.css');
  // The site's own Meteor values are the defaults; the header script and the menu know every theme.
  const header = await readFile(resolve(root, 'site/index.html'), 'utf8');
  for (const id of THEME_IDS) assert.ok(header.includes(`data-theme-id="${id}"`) && header.includes(`'${id}'`), `site header offers ${id}`);
  for (const id of THEME_IDS.filter((id) => id !== 'meteor')) for (const scheme of ['light', 'dark']) {
    const tokens = siteTokens(id, scheme);
    for (const [text, ground] of [['ink', 'paper'], ['ink-2', 'paper'], ['muted', 'paper'], ['muted', 'paper-2'], ['ink', 'card'], ['lime-deep', 'paper'], ['lime-deep', 'card'], ['ink', 'lime-wash'], ['night-ink', 'night'], ['night-muted', 'night'], ['night-muted', 'night-2'], ['lime', 'night'], ['night', 'lime']]) {
      assert.ok(ratio(tokens[text], tokens[ground]) >= 4.5, `site ${id} ${scheme} ${text} on ${ground} ${ratio(tokens[text], tokens[ground]).toFixed(2)}`);
    }
  }
});

test('settings accept exactly the theme ids', () => {
  const state = createState();
  for (const theme of THEME_IDS) assert.equal(reduceState(state, { type: 'settings.update', patch: { theme } }).settings.theme, theme);
  assert.throws(() => reduceState(state, { type: 'settings.update', patch: { theme: 'Meteor' } }), /theme must be one of/);
});
