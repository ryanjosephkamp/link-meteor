# Link Meteor brand assets

Original artwork for Link Meteor. The mark is a meteor: a bright head (the link) with a tapering, fading trail (the path back to its source).

| File | Use |
| --- | --- |
| `icon.svg` | Full-bleed app icon master for toolbar-sized rasters (32 px, 48 px). |
| `icon-16.svg` | Simplified 16 px toolbar icon. |
| `icon-128.svg` | 128 px icon with 96 px artwork and 16 px transparent padding, per Chrome Web Store icon guidance. |
| `mark.svg` | Inline mark (no tile) for dark surfaces. |

Colors: tile `#161d2d` (ink, `oklch(0.235 0.03 265)`), meteor `#c3f344` (fireball lime, `oklch(0.9 0.2 124)`).

Regenerate the packaged PNGs with `node scripts/make-icons.mjs` (uses the locally installed Playwright Chromium; nothing is downloaded).
