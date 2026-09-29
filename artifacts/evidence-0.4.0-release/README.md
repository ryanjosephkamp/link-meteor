# Evidence: 0.4.0 package and site (September 29, 2026)

These checks cover the packaged 0.4.0 ZIP and the website that offers it. The extension itself was tested as release candidate 3: see [`../evidence-0.4.0-rc3/`](../evidence-0.4.0-rc3/README.md), which also holds the [Chrome 116 results](../evidence-0.4.0-rc3/chrome-116/README.md).

## Package

- **Build.** `npm run build`, then `npm run package`, from a clean tree at `4ea3614`, whose `src/` is unchanged from the tested `02e6b3d`.
- **Output.** [`link-meteor-0.4.0.zip`](../link-meteor-0.4.0.zip): 570,447 bytes, 45 files, SHA-256 `68105db8e9dc47e1a222a2f668e5cbc22df315f8a24f09d83f57f036f6bc7036`.
- **Receipt.** [`link-meteor-0.4.0.sha256.json`](../link-meteor-0.4.0.sha256.json) says `sourceFilesGitDirty: false`. Its `gitWorkingTreeDirtyAtPackaging: true` counts only the new ZIP and receipt, which were untracked when the script checked, as for 0.3.0.
- **Checks on the package:**
  - every ZIP member equals its `src/` file byte for byte (`verifyPackagedSource`, in the unit tests);
  - every receipt hash matches both the ZIP member and `src/`;
  - the ZIP passes an integrity test (`unzip -t`);
  - the ZIP's contents are byte-identical to the release candidate 3 copy.
- **`npm test`:** 163/163, now including the current-ZIP check. [Output](node-tests.txt).

## Site

| Check | Result | Notes |
| --- | --- | --- |
| `node scripts/sync-site.mjs --check` | Pass | These all match the 0.4.0 build: the ZIP, its hash and size, `latest.json`, the export modules, the icons, the shared header and footer, and the install page's build details. [Output](sync-site-check.txt). |
| `npm run check` | 14 of 14, pass | Every check without grants, on the finished tree, including `site-check` and the site/package sync. [Summary](check-summary.md). |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). Pages across widths and light and dark themes, every site theme, links, structure and sampled contrast, the keyboard menu, the interactive demo, the export preview using the synced 0.4.0 export modules, 404 handling and both videos. |

What changed on the site for 0.4.0:
- **Guide:** new sections for *After a drag*, the right-click menus, downloading the files behind links, and appearance. Saving tabs as links, the card's filters, already saved links and navigation links, custom columns, rich links and Copy diagnostics are added to the existing sections.
- **Home page:**
  - saving the tabs themselves;
  - custom columns and downloads;
  - rich links and linked files among the outputs;
  - a privacy line that says Link Meteor visits a site only when you ask it to open a link or download a file.
- **Install page:** what has been tested (0.4.0 on macOS, the checks without grants on Windows and Linux, and Chrome 116), Brave and Edge as tested with 0.3.0, and a note that 0.3.0 can't restore a 0.4.0 backup.
- **Privacy page** (changed during release candidate 2): the `downloads` permission and the new menus.
- **Theme menu** (changed during release candidate 1): every palette in light and dark.

The videos and the four product screenshots still show 0.2.2. Nothing was deployed: the live site changes only when the reviewer deploys it.
