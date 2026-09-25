# Link Meteor website

Static site for GitHub Pages. Plain HTML, CSS and JavaScript with no build step, no dependencies, no cookies, no analytics and no third-party requests. Fonts (Atkinson Hyperlegible Next and Mono, SIL Open Font License) are self-hosted under `assets/fonts/` with their licenses.

This folder is published as-is. It is **not deployed** yet.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home: interactive capture demo, field separation, scopes, honest reporting, curation, export preview, privacy promise, limits. |
| `install.html` | Development-build installation, update, removal and troubleshooting. Build details are filled from the packaged ZIP. |
| `guide.html` | Full help reference. |
| `privacy.html` | Extension and website privacy, with every permission explained. |
| `practice.html` | Sandbox of synthetic links. Each section's `data-expect` is its answer key, verified with the real extension by `tests/site-browser.mjs`. |
| `practice-frame.html` | Same-origin frame used by the practice page. |
| `404.html` | Not-found page. Uses absolute `/link-meteor/` paths because GitHub Pages serves it at any depth. |

The home page's export preview imports `assets/js/core/export.js` and `xlsx.js`, exact copies of the extension's export modules. `downloads/` holds the development ZIP offered on the install page.

## Keeping it in sync

```sh
npm run build && npm run package   # new extension ZIP in artifacts/
node scripts/sync-site.mjs         # copy ZIP, export modules, icons; fill install page; sync header/footer
node scripts/sync-site.mjs --check # verify; the deploy workflow runs this first
```

The header and footer are authored once in `index.html` (between `site-header` / `site-footer` markers) and copied into the other pages by the sync script.

## Checks

```sh
node tests/site-check.mjs      # all pages × 5 widths × light/dark, links, anchors, structure, contrast, demo
node tests/site-preview.mjs    # ad-hoc screenshots into .scratch/site-preview
```

`tests/site-browser.mjs` (loaded extension, prepared test profile) verifies the practice page's answer keys and renders the real screenshots in `assets/img/shot-*.webp`.

## Deploying later

1. Merge the branch into `main`.
2. In the repository's Settings → Pages, set Source to **GitHub Actions**.
3. In Actions, run **Deploy site to GitHub Pages (manual)**.

The site will be at `https://ryanjosephkamp.github.io/link-meteor/`. If a custom domain is used instead, update the absolute paths in `404.html`, and consider making the `og:image` URL absolute in each page's head.
