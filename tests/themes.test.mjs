// Themes (0.4.0): every theme is complete, Meteor is exactly today's look, and every theme's text
// colors meet WCAG AA (4.5:1) against the grounds they sit on, computed from the color values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const luminance = (color) => srgb(color).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (fore, back) => { const [a, b] = [luminance(fore), luminance(back)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

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
    const t = THEMES[id][scheme], c = THEMES[id].card[scheme];
    for (const ground of ['bg', 'surface']) {
      for (const text of ['ink', 'ink-2', 'muted', 'accent-text', 'danger']) check(id, scheme, `${text} on ${ground}`, t[text], t[ground]);
    }
    check(id, scheme, 'muted on sunken', t.muted, t.sunken);
    check(id, scheme, 'ink on accent-wash', t.ink, t['accent-wash']);
    check(id, scheme, 'on-accent on accent', t['on-accent'], t.accent);
    for (const text of ['strong', 'ink', 'soft', 'muted', 'warn', 'link']) check(id, scheme, `card ${text}`, c[text], c.ground);
    check(id, scheme, 'card on-accent', c['on-accent'], c.accent);
  }
  assert.deepEqual(low, []);
});

test('settings accept exactly the theme ids', () => {
  const state = createState();
  for (const theme of THEME_IDS) assert.equal(reduceState(state, { type: 'settings.update', patch: { theme } }).settings.theme, theme);
  assert.throws(() => reduceState(state, { type: 'settings.update', patch: { theme: 'Meteor' } }), /theme must be one of/);
});
