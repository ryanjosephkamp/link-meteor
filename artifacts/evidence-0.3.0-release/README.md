# Evidence: 0.3.0 package and site (September 27, 2026)

These checks cover the packaged 0.3.0 ZIP and the website that offers it. The extension itself was tested as release candidate 2: see [`../evidence-0.3.0-rc2/`](../evidence-0.3.0-rc2/README.md), which also holds the [Chrome 116 results](../evidence-0.3.0-rc2/chrome-116/README.md).

## Package

- **Build.** `npm run build`, then `npm run package`, from a clean tree at `a1901db`, whose `src/` is unchanged from the tested `bd3f6b5`.
- **Output.** [`link-meteor-0.3.0.zip`](../link-meteor-0.3.0.zip): 368,539 bytes, 35 files, SHA-256 `25463687d2f0a7b9e280de7d4f905753cb9b8cc57b359129937f8ea5e98302c7`.
- **Receipt.** [`link-meteor-0.3.0.sha256.json`](../link-meteor-0.3.0.sha256.json) says `sourceFilesGitDirty: false`. Its `gitWorkingTreeDirtyAtPackaging: true` counts only the new ZIP and receipt, which were untracked when the script checked, as for 0.2.2.
- **Checks on the package:**
  - every ZIP member equals its `src/` file byte for byte (`verifyPackagedSource`);
  - every receipt hash matches both the ZIP member and `src/`;
  - the ZIP passes an integrity test;
  - the ZIP's contents are byte-identical to the release candidate 2 copy the owner checked by hand.
- **`npm test`:** 94/94, now including the current-ZIP check. [Output](node-tests.txt).

## Site

| Check | Result | Notes |
| --- | --- | --- |
| `node scripts/sync-site.mjs --check` | Pass | These all match the 0.3.0 build: the ZIP, its hash and size, `latest.json`, the export modules, the icons, the shared header and footer, and the install page's build details. [Output](sync-site-check.txt). |
| `tests/site-check.mjs` | Pass | [Results](site-results.json). Covers:<br>• pages across widths and light and dark themes;<br>• links, structure and sampled contrast;<br>• the keyboard menu and the interactive demo;<br>• the export preview, using the synced 0.3.0 export modules;<br>• 404 handling and both videos. |

What changed on the site for 0.3.0:
- **Install page:** the download, the tested-so-far note, a new **Works in** section, the folder listing in the Load step, update and troubleshooting.
- **Privacy page:** all-sites access, `tabGroups`, `unlimitedStorage`, bookmark folder reading, backups and the restore Undo.
- **Guide:** hold-key drag, the capture card, opening up to 500, export names and workbooks, existing bookmark folders, backup and restore.
- **Home page:** the hold key, output options and limits.

The videos and the four product screenshots still show 0.2.2. The home, install and About pages say the videos were recorded with 0.2.2, and the full-view screenshot's alt text names its version. Nothing was deployed: the live site changes only when the reviewer deploys it.
