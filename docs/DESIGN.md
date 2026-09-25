# Link Meteor design system

Companion to [PRODUCT.md](PRODUCT.md). Two registers share one identity: the extension is product UI (quiet, dense, familiar), the site is brand (committed, expressive). Both are built from the same tokens, mark and voice.

## Identity

- **Mark:** a meteor, a bright head (the link) with a tapering, fading trail (the path back to its source). Masters live in `assets/brand/`; `node scripts/make-icons.mjs` renders the packaged PNGs.
- **Colors:** night ink `oklch(0.2–0.24 0.03 265)` and fireball lime `oklch(0.9 0.2 124)` (`#c3f344`). Bright meteors often glow green; lime also reads as a highlighter, which is what region capture does to links.
- **Voice:** precise, candid, quick. Exact counts and scopes ("Capture 3 tabs", "All 71 rows in this view"), plain explanations of permissions and limits, no hype.

## Color tokens

Neutrals are tinted toward hue 265 (ink), never toward warm cream. OKLCH throughout; values verified for contrast (see `tests/visual-browser.mjs` and `tests/site-check.mjs`).

| Role | Light | Dark |
| --- | --- | --- |
| Background | `oklch(0.985 0.004 265)` | `oklch(0.185 0.016 265)` extension / `0.155` site |
| Surface / card | `oklch(1 0 0)` | `oklch(0.215 0.018 265)` |
| Ink (text) | `oklch(0.24 0.03 265)` | `oklch(0.955 0.006 265)` |
| Muted text | `oklch(0.5 0.024 265)`, 5.8:1 on surface | `oklch(0.73 0.02 265)`, 7.8:1 |
| Accent fill | lime `oklch(0.9 0.2 124)` with ink text, 13:1 | same |
| Accent text | `oklch(0.5 0.14 138)`, 5.1:1+ | `oklch(0.88 0.18 124)` |
| Accent wash (selection, target) | `oklch(0.968 0.045 120)` | `oklch(0.255 0.045 128)` |
| Danger | `oklch(0.54 0.19 27)` | `oklch(0.78 0.12 25)` |
| Warning | `oklch(0.52 0.11 62)` | `oklch(0.84 0.12 80)` |
| Focus ring | ink (light), lime (dark), 2 px, 2 px offset | |

Strategy: the extension is **restrained** (lime only on the primary action, selection, count badges and highlights); the site is **committed** (night hero and privacy bands, lime headline and highlighter marks).

## Typography

- **Extension:** the system UI stack at a tight fixed scale (0.72 / 0.78 / 0.845 / 0.94 / 1.06 / 1.3 rem), weight 600–700 for headings and labels, tabular numerals for counts. `ui-monospace` only for exact provenance values (hrefs, IDs).
- **Site:** Atkinson Hyperlegible Next (variable, 200–800) for everything, Atkinson Hyperlegible Mono for URLs, code and data. Chosen because it was designed to tell look-alike characters apart, fitting a product whose promise is exact strings. Display: weight 800, tracking −0.035em, fluid `clamp()` up to 6 rem. Body 17 px / 1.6. Self-hosted, Latin subset, about 84 KB total.

## Extension surfaces

- **Overlay (content script, shadow DOM):** a consistent ink card on every site, light or dark. Lime highlighter marks on matched link boxes, a lime-edged selection rectangle with an ink hairline, and a pill count badge. After release the card names the destination collection, previews the first three labels, and offers Copy text + URL (primary), Add to collection, Review, and Add another region. Accessible names and the `.count` / `.badge` / `.status` text contracts are unchanged.
- **Side panel (below 900 px):** one column with three views (links, collections and site settings, export) and a bottom dock showing the exact target plus quick copy. Views change with a 200 ms rise, instant under reduced motion.
- **Full tab (900 px and up):** three columns (collections rail, links, export). Rows switch to Anchor text / URL / Source columns through a container query at 640 px of list width.
- **Rows:** anchor text first (semibold); empty anchors show "No anchor text" in muted italics with the accessible label beside it; the URL shows the exact string with the host emphasized; the source page and host; badges for file type, email/phone and grouped counts; "Also labeled …" and "and N other pages" in grouped views; a chevron opens full provenance and per-occurrence notes.
- **States:** inline confirmations (open tabs, delete collection) instead of `window.confirm`; toasts for notices (auto-dismiss) and errors (persistent, dismissible); an arrival highlight for newly captured rows; capture reports distinguish captured, no links, access denied, unsupported and failed, with plain explanations and Chrome's raw message kept.

## Components

One button vocabulary: `btn` (outlined), `primary` (lime), `quiet` (text), `danger`, `small`, `icon-btn`. One icon set: hand-drawn 20 px stroke icons (1.6 px, round caps) defined once as an SVG sprite in `workbench.html` and mirrored in `site/assets/img/icons.svg`. Radii 6 / 8 / 12 px (extension) and 8 / 12 / 14–24 px (site).

## Motion

Only state changes move: hover and press (150 ms), view changes (200 ms), toasts (220 ms), row arrival (2.6 s fade), the overlay card rise (180 ms), and on the site the demo's selection sweep. Every animation has a `prefers-reduced-motion` alternative. No scroll-triggered reveals.

## Accessibility commitments

Visible focus everywhere; accessible names that contain the visible label; `aria-live` for counts, notices and reports, `role="alert"` for errors; state never conveyed by color alone (icons plus words for report statuses, text badges); 4.5:1 minimum for text, measured in both themes; layouts verified from 320 px; forced-colors fallbacks for selection and segments.
