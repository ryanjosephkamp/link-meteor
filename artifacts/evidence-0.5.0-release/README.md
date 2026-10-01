# Evidence: 0.5.0 package and site (October 1, 2026)

These checks cover the packaged 0.5.0 ZIP and the website that offers it. The extension itself was tested as release candidate 3: see [`../evidence-0.5.0-rc3/`](../evidence-0.5.0-rc3/README.md), which also holds the [Chrome 116 results](../evidence-0.5.0-rc3/chrome-116/README.md).

## Package

- **Build.** `npm run build`, then `npm run package`, from a clean tree at `83e76e0`, whose `src/` is unchanged from the tested `91e851b`.
- **Output.** [`link-meteor-0.5.0.zip`](../link-meteor-0.5.0.zip): 801,611 bytes, 57 files, SHA-256 `57020852b82b26d8d0562707bddeb00ef4ffcd5875264c23ba0e6da875ff589f`.
- **Receipt.** [`link-meteor-0.5.0.sha256.json`](../link-meteor-0.5.0.sha256.json) says `sourceFilesGitDirty: false`. Its `gitWorkingTreeDirtyAtPackaging: true` counts only the new ZIP and receipt, which were untracked when the script checked, as for 0.4.0.
- **Checks on the package:**
  - every ZIP member equals its `src/` file byte for byte (`verifyPackagedSource`, in the unit tests);
  - every receipt hash matches both the ZIP member and `src/`;
  - the ZIP passes an integrity test (`unzip -t`);
  - the ZIP's contents are byte-identical to the release candidate 3 copy.
- **`npm test`:** 235/235, now including the current-ZIP check. [Output](node-tests.txt).

## Site

| Check | Result | Notes |
| --- | --- | --- |
| `node scripts/sync-site.mjs --check` | Pass | These all match the 0.5.0 build: the ZIP, its hash and size, `latest.json`, the export modules, the icons, the shared header and footer, and the install page's build details. [Output](sync-site-check.txt). |
| `npm run check` | 17 of 17, pass | Every check without grants, on the finished tree, including `site-check` and the site/package sync. [Summary](check-summary.md). |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). Pages across widths and light and dark themes, every site theme, links, structure and sampled contrast, the keyboard menu, the interactive demo, the export preview using the synced 0.5.0 export modules, 404 handling and both videos. |

**The sync list grew.** Since 0.5.0, the extension's export module imports its citation and identifier modules. The first sync copied only the export and workbook modules, and `site-check` failed on the missing files. `scripts/sync-site.mjs` now copies all four, and checks all four.

What changed on the site for 0.5.0:
- **Guide:**
  - new sections for context and citations, and for importing links;
  - reading status and stars, Insights, and Move to… and Copy to… under *Review and curate*;
  - citation formats and the new columns under *Copy and export*;
  - the side panel's Full view button, the toolbar icon closing the panel, the last backup's date, and what works on a PDF.
- **Home page:**
  - reading status, stars and Insights; citation details and identifiers; moving, copying and importing links;
  - BibTeX, RIS, CSL-JSON, the annotated bibliography and the Obsidian note among the outputs;
  - the limits now say that nothing is looked up online, and that a link in a PDF can be saved by right-clicking it.
- **Install page:** what has been tested (0.5.0 on macOS, the checks without grants on Windows and Linux, and Chrome 116), and a note that 0.4.0 can't restore a 0.5.0 backup.
- **Privacy page** (changed during the release candidates): what 0.5.0 stores, the last backup's time, and the short-lived Undo lists.

The videos and the four product screenshots still show 0.2.2. Nothing was deployed: the live site changes only when the reviewer deploys it.
