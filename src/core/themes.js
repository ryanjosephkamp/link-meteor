// Themes (0.4.0): pure data, no Chrome or DOM. Each theme has a full set of workbench color
// tokens for light and dark (the custom properties in ui/workbench.css), the on-page card's color
// roles for light and dark, and the highlight used for the selection box and matched links on
// web pages (the same in both modes, always with a dark ring). Meteor is today's look, exactly.

export const THEME_IDS = Object.freeze(['meteor', 'comet', 'aurora', 'ember', 'nebula', 'graphite', 'contrast']);

// Today's workbench tokens (Meteor), for each scheme. Other themes override some of them.
const BASE = {
  light: {
    bg: 'oklch(0.985 0.004 265)', surface: 'oklch(1 0 0)', sunken: 'oklch(0.963 0.006 265)', hover: 'oklch(0.967 0.007 265)',
    line: 'oklch(0.915 0.009 265)', 'line-strong': 'oklch(0.84 0.013 265)', ink: 'oklch(0.24 0.03 265)', 'ink-2': 'oklch(0.37 0.03 265)', muted: 'oklch(0.5 0.024 265)',
    accent: 'oklch(0.9 0.2 124)', 'accent-hover': 'oklch(0.87 0.2 126)', 'accent-edge': 'oklch(0.76 0.18 128)', 'on-accent': 'oklch(0.22 0.03 265)',
    'accent-text': 'oklch(0.5 0.14 138)', 'accent-wash': 'oklch(0.968 0.045 120)', 'accent-wash-strong': 'oklch(0.935 0.085 122)',
    danger: 'oklch(0.54 0.19 27)', 'danger-wash': 'oklch(0.967 0.018 25)', 'danger-line': 'oklch(0.86 0.06 25)', warn: 'oklch(0.52 0.11 62)', 'warn-wash': 'oklch(0.97 0.035 85)',
    focus: 'oklch(0.3 0.06 265)', check: 'var(--ink)', 'mark-tile': 'oklch(0.235 0.03 265)', 'mark-head': 'oklch(0.9 0.2 124)',
    'shadow-sm': '0 1px 2px oklch(0.24 0.03 265 / 0.06)', shadow: '0 1px 2px oklch(0.24 0.03 265 / 0.06), 0 10px 28px -6px oklch(0.24 0.03 265 / 0.14)',
  },
  dark: {
    bg: 'oklch(0.185 0.016 265)', surface: 'oklch(0.215 0.018 265)', sunken: 'oklch(0.165 0.015 265)', hover: 'oklch(0.245 0.02 265)',
    line: 'oklch(0.3 0.02 265)', 'line-strong': 'oklch(0.4 0.024 265)', ink: 'oklch(0.955 0.006 265)', 'ink-2': 'oklch(0.86 0.012 265)', muted: 'oklch(0.73 0.02 265)',
    accent: 'oklch(0.9 0.2 124)', 'accent-hover': 'oklch(0.93 0.19 124)', 'accent-edge': 'oklch(0.9 0.2 124)', 'on-accent': 'oklch(0.22 0.03 265)',
    'accent-text': 'oklch(0.88 0.18 124)', 'accent-wash': 'oklch(0.255 0.045 128)', 'accent-wash-strong': 'oklch(0.31 0.075 128)',
    danger: 'oklch(0.78 0.12 25)', 'danger-wash': 'oklch(0.26 0.055 25)', 'danger-line': 'oklch(0.42 0.1 25)', warn: 'oklch(0.84 0.12 80)', 'warn-wash': 'oklch(0.27 0.045 80)',
    focus: 'oklch(0.9 0.2 124)', check: 'oklch(0.9 0.2 124)', 'mark-tile': 'oklch(0.29 0.03 265)', 'mark-head': 'oklch(0.9 0.2 124)',
    'shadow-sm': '0 1px 2px oklch(0 0 0 / 0.3)', shadow: '0 1px 2px oklch(0 0 0 / 0.35), 0 12px 32px -8px oklch(0 0 0 / 0.6)',
  },
};
export const WORKBENCH_TOKENS = Object.freeze(Object.keys(BASE.light));
export const CARD_ROLES = Object.freeze(['ground', 'ground2', 'strong', 'ink', 'soft', 'muted', 'faint', 'warn', 'accent', 'accent-hover', 'on-accent', 'link', 'link-hover', 'focus']);

// Neutrals at today's lightness steps, tinted toward hue h with chroma scaled by c.
const n = (l, ch, h, c) => `oklch(${l} ${+(ch * c).toFixed(4)} ${h})`;
function neutrals(h, c) {
  return {
    light: { bg: n(0.985, 0.004, h, c), sunken: n(0.963, 0.006, h, c), hover: n(0.967, 0.007, h, c), line: n(0.915, 0.009, h, c), 'line-strong': n(0.84, 0.013, h, c), ink: n(0.24, 0.03, h, c), 'ink-2': n(0.37, 0.03, h, c), muted: n(0.5, 0.024, h, c), 'mark-tile': n(0.235, 0.03, h, c) },
    dark: { bg: n(0.185, 0.016, h, c), surface: n(0.215, 0.018, h, c), sunken: n(0.165, 0.015, h, c), hover: n(0.245, 0.02, h, c), line: n(0.3, 0.02, h, c), 'line-strong': n(0.4, 0.024, h, c), ink: n(0.955, 0.006, h, c), 'ink-2': n(0.86, 0.012, h, c), muted: n(0.73, 0.02, h, c), 'mark-tile': n(0.29, 0.03, h, c) },
    card: {
      light: { ground: 'oklch(1 0 0)', ground2: n(0.97, 0.005, h, c), strong: n(0.2, 0.03, h, c), ink: n(0.27, 0.03, h, c), soft: n(0.35, 0.03, h, c), muted: n(0.5, 0.024, h, c), faint: n(0.6, 0.02, h, c), warn: 'oklch(0.5 0.11 62)' },
      dark: { ground: n(0.215, 0.03, h, c), ground2: n(0.18, 0.025, h, c), strong: 'oklch(1 0 0)', ink: n(0.955, 0.006, h, c), soft: n(0.9, 0.01, h, c), muted: n(0.74, 0.02, h, c), faint: n(0.6, 0.02, h, c), warn: 'oklch(0.84 0.11 80)' },
    },
  };
}

// One accent family: fill (buttons, selection), text (links and labels on the page ground), washes.
function accents({ h, fill: [fl, fc], text: [tl, tc, th = h], darkText: [dl, dc], onAccentHue, focusLight, focusDark }) {
  const fill = `oklch(${fl} ${fc} ${h})`;
  return {
    light: { accent: fill, 'accent-hover': `oklch(${+(fl - 0.03).toFixed(3)} ${fc} ${h + 2})`, 'accent-edge': `oklch(${+(fl - 0.14).toFixed(3)} ${+(fc * 0.9).toFixed(3)} ${h + 4})`, 'on-accent': `oklch(0.22 0.03 ${onAccentHue})`, 'accent-text': `oklch(${tl} ${tc} ${th})`, 'accent-wash': `oklch(0.968 ${+(fc * 0.24).toFixed(3)} ${h})`, 'accent-wash-strong': `oklch(0.935 ${+(fc * 0.45).toFixed(3)} ${h})`, focus: focusLight, 'mark-head': fill },
    dark: { accent: fill, 'accent-hover': `oklch(${+(fl + 0.03).toFixed(3)} ${+(fc * 0.95).toFixed(3)} ${h})`, 'accent-edge': fill, 'on-accent': `oklch(0.22 0.03 ${onAccentHue})`, 'accent-text': `oklch(${dl} ${dc} ${h})`, 'accent-wash': `oklch(0.255 ${+(fc * 0.24).toFixed(3)} ${h + 4})`, 'accent-wash-strong': `oklch(0.31 ${+(fc * 0.4).toFixed(3)} ${h + 4})`, focus: focusDark || fill, check: fill, 'mark-head': fill },
  };
}

// danger (optional, per scheme) keeps an accent near red apart from the danger color.
function hued({ id, name, blurb, nh, nc, accent, highlight, edge, danger = {} }) {
  const base = neutrals(nh, nc), acc = accents(accent);
  const card = (mode) => ({ ...base.card[mode], accent: acc[mode].accent, 'accent-hover': acc[mode]['accent-hover'], 'on-accent': acc[mode]['on-accent'], link: acc[mode]['accent-text'], 'link-hover': acc[mode]['accent-text'], focus: mode === 'dark' ? acc.dark.accent : acc.light['accent-text'] });
  return { id, name, blurb, swatch: acc.dark.accent, highlight, edge, light: { ...BASE.light, ...base.light, ...acc.light, ...danger.light }, dark: { ...BASE.dark, ...base.dark, ...acc.dark, ...danger.dark }, card: { light: card('light'), dark: card('dark') } };
}

const meteorLight = neutrals(265, 1).card.light;
const meteor = {
  id: 'meteor', name: 'Meteor', blurb: 'Lime on slate. The original.', swatch: '#c3f344', highlight: '#c3f344', edge: 'rgba(126,168,27,.95)',
  light: { ...BASE.light }, dark: { ...BASE.dark },
  card: {
    light: { ...meteorLight, accent: 'oklch(0.9 0.2 124)', 'accent-hover': 'oklch(0.87 0.2 126)', 'on-accent': 'oklch(0.22 0.03 265)', link: 'oklch(0.5 0.14 138)', 'link-hover': 'oklch(0.5 0.14 138)', focus: 'oklch(0.5 0.14 138)' },
    // The card as it has always looked, color for color.
    dark: { ground: '#161d2d', ground2: '#0f1422', strong: '#fff', ink: '#eef0f4', soft: '#dfe3ea', muted: '#a2a8b5', faint: '#7d8394', warn: '#f4c26a', accent: '#c3f344', 'accent-hover': '#d4f86f', 'on-accent': '#161d2d', link: '#c3f344', 'link-hover': '#d4f86f', focus: '#c3f344' },
  },
};

const graphite = (() => {
  const g = neutrals(0, 0);
  return {
    id: 'graphite', name: 'Graphite', blurb: 'No hue at all: graphite and silver.', swatch: 'oklch(0.9 0 0)', highlight: 'oklch(0.74 0 0)', edge: 'oklch(0.36 0 0)',
    light: { ...BASE.light, ...g.light, accent: 'oklch(0.3 0 0)', 'accent-hover': 'oklch(0.37 0 0)', 'accent-edge': 'oklch(0.2 0 0)', 'on-accent': 'oklch(0.985 0 0)', 'accent-text': 'oklch(0.3 0 0)', 'accent-wash': 'oklch(0.955 0 0)', 'accent-wash-strong': 'oklch(0.905 0 0)', focus: 'oklch(0.3 0 0)', 'mark-head': 'oklch(0.9 0 0)' },
    dark: { ...BASE.dark, ...g.dark, accent: 'oklch(0.9 0 0)', 'accent-hover': 'oklch(0.95 0 0)', 'accent-edge': 'oklch(0.9 0 0)', 'on-accent': 'oklch(0.2 0 0)', 'accent-text': 'oklch(0.92 0 0)', 'accent-wash': 'oklch(0.27 0 0)', 'accent-wash-strong': 'oklch(0.33 0 0)', focus: 'oklch(0.92 0 0)', check: 'oklch(0.9 0 0)', 'mark-head': 'oklch(0.9 0 0)' },
    card: {
      light: { ...g.card.light, accent: 'oklch(0.3 0 0)', 'accent-hover': 'oklch(0.37 0 0)', 'on-accent': 'oklch(0.985 0 0)', link: 'oklch(0.3 0 0)', 'link-hover': 'oklch(0.3 0 0)', focus: 'oklch(0.3 0 0)' },
      dark: { ...g.card.dark, accent: 'oklch(0.9 0 0)', 'accent-hover': 'oklch(0.95 0 0)', 'on-accent': 'oklch(0.2 0 0)', link: 'oklch(0.92 0 0)', 'link-hover': 'oklch(0.92 0 0)', focus: 'oklch(0.92 0 0)' },
    },
  };
})();

const yellow = 'oklch(0.92 0.19 105)', blue = 'oklch(0.42 0.26 264)';
const contrast = {
  id: 'contrast', name: 'High contrast', blurb: 'Black and white, with blue links in light mode and yellow in dark mode.', swatch: yellow, highlight: yellow, edge: 'oklch(0 0 0)',
  light: { ...BASE.light, bg: 'oklch(1 0 0)', surface: 'oklch(1 0 0)', sunken: 'oklch(0.96 0 0)', hover: 'oklch(0.93 0 0)', line: 'oklch(0.45 0 0)', 'line-strong': 'oklch(0.15 0 0)', ink: 'oklch(0 0 0)', 'ink-2': 'oklch(0.15 0 0)', muted: 'oklch(0.3 0 0)', 'mark-tile': 'oklch(0 0 0)', accent: 'oklch(0 0 0)', 'accent-hover': 'oklch(0.25 0 0)', 'accent-edge': 'oklch(0 0 0)', 'on-accent': 'oklch(1 0 0)', 'accent-text': blue, 'accent-wash': 'oklch(0.94 0.03 264)', 'accent-wash-strong': 'oklch(0.88 0.06 264)', focus: blue, check: 'oklch(0 0 0)', 'mark-head': yellow, danger: 'oklch(0.45 0.2 27)', warn: 'oklch(0.42 0.12 60)' },
  dark: { ...BASE.dark, bg: 'oklch(0 0 0)', surface: 'oklch(0.13 0 0)', sunken: 'oklch(0.07 0 0)', hover: 'oklch(0.22 0 0)', line: 'oklch(0.62 0 0)', 'line-strong': 'oklch(0.88 0 0)', ink: 'oklch(1 0 0)', 'ink-2': 'oklch(0.94 0 0)', muted: 'oklch(0.86 0 0)', 'mark-tile': 'oklch(0.13 0 0)', accent: yellow, 'accent-hover': 'oklch(0.95 0.17 105)', 'accent-edge': yellow, 'on-accent': 'oklch(0 0 0)', 'accent-text': yellow, 'accent-wash': 'oklch(0.25 0.05 105)', 'accent-wash-strong': 'oklch(0.32 0.08 105)', focus: yellow, check: yellow, 'mark-head': yellow, danger: 'oklch(0.78 0.14 25)', warn: 'oklch(0.9 0.15 90)' },
  card: {
    light: { ground: 'oklch(1 0 0)', ground2: 'oklch(0.96 0 0)', strong: 'oklch(0 0 0)', ink: 'oklch(0 0 0)', soft: 'oklch(0.15 0 0)', muted: 'oklch(0.3 0 0)', faint: 'oklch(0.42 0 0)', warn: 'oklch(0.42 0.12 60)', accent: 'oklch(0 0 0)', 'accent-hover': 'oklch(0.25 0 0)', 'on-accent': 'oklch(1 0 0)', link: blue, 'link-hover': blue, focus: blue },
    dark: { ground: 'oklch(0 0 0)', ground2: 'oklch(0.1 0 0)', strong: 'oklch(1 0 0)', ink: 'oklch(1 0 0)', soft: 'oklch(0.94 0 0)', muted: 'oklch(0.86 0 0)', faint: 'oklch(0.72 0 0)', warn: 'oklch(0.9 0.15 90)', accent: yellow, 'accent-hover': 'oklch(0.95 0.17 105)', 'on-accent': 'oklch(0 0 0)', link: yellow, 'link-hover': yellow, focus: yellow },
  },
};

export const THEMES = Object.freeze(Object.fromEntries([
  meteor,
  hued({ id: 'comet', name: 'Comet', blurb: 'Icy cyan on cool blue-gray.', nh: 235, nc: 1, accent: { h: 205, fill: [0.86, 0.12], text: [0.5, 0.1, 215], darkText: [0.86, 0.11], onAccentHue: 235, focusLight: 'oklch(0.3 0.06 235)' }, highlight: 'oklch(0.86 0.12 205)', edge: 'oklch(0.6 0.11 212)' }),
  hued({ id: 'aurora', name: 'Aurora', blurb: 'Mint teal with a violet focus ring.', nh: 195, nc: 0.9, accent: { h: 168, fill: [0.85, 0.14], text: [0.5, 0.1, 172], darkText: [0.86, 0.12], onAccentHue: 200, focusLight: 'oklch(0.48 0.2 295)', focusDark: 'oklch(0.78 0.14 295)' }, highlight: 'oklch(0.85 0.14 168)', edge: 'oklch(0.6 0.12 172)', danger: { dark: { danger: 'oklch(0.74 0.12 25)' } } }),
  hued({ id: 'ember', name: 'Ember', blurb: 'Glowing coal orange on warm gray.', nh: 45, nc: 0.8, accent: { h: 42, fill: [0.78, 0.15], text: [0.52, 0.15, 38], darkText: [0.83, 0.12], onAccentHue: 45, focusLight: 'oklch(0.32 0.06 45)' }, highlight: 'oklch(0.78 0.15 42)', edge: 'oklch(0.56 0.15 38)', danger: { dark: { danger: 'oklch(0.7 0.19 12)' } } }),
  hued({ id: 'nebula', name: 'Nebula', blurb: 'Violet pink on a purple-tinted gray.', nh: 300, nc: 1, accent: { h: 315, fill: [0.8, 0.14], text: [0.52, 0.18, 310], darkText: [0.84, 0.12], onAccentHue: 300, focusLight: 'oklch(0.32 0.07 300)' }, highlight: 'oklch(0.8 0.14 315)', edge: 'oklch(0.58 0.16 310)' }),
  graphite,
  contrast,
].map((theme) => [theme.id, theme])));

const themeOf = (id) => THEMES[id] || THEMES.meteor;
const schemeOf = (scheme) => (scheme === 'dark' ? 'dark' : 'light');

// The workbench's CSS for a theme in one scheme: every token, so it fully replaces the
// stylesheet's own light and dark values whatever the system setting is.
export function themeCss(id, scheme) {
  const s = schemeOf(scheme), tokens = themeOf(id)[s];
  return `:root{color-scheme:${s};${WORKBENCH_TOKENS.map((key) => `--${key}:${tokens[key]}`).join(';')}}`;
}

// The on-page card's custom properties for a theme in one scheme, as {'--k-role': value}.
export function cardVars(id, scheme) {
  const s = schemeOf(scheme), theme = themeOf(id), roles = theme.card[s];
  const shadows = s === 'dark' ? ['rgba(8,11,20,.45)', 'rgba(8,11,20,.25)'] : ['rgba(20,24,40,.18)', 'rgba(20,24,40,.12)'];
  return {
    ...Object.fromEntries(CARD_ROLES.map((role) => [`--k-${role}`, roles[role]])),
    '--k-hl': theme.highlight, '--k-edge': theme.edge, '--k-shadow-45': shadows[0], '--k-shadow-25': shadows[1], 'color-scheme': s,
  };
}

// What the page script needs to draw the card: both schemes, so it can follow the system setting itself.
export function cardTheme(id, appearance) {
  return { theme: themeOf(id).id, appearance, light: cardVars(id, 'light'), dark: cardVars(id, 'dark') };
}
