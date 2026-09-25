# Packaging and workbook verification handback

Owned source files: `scripts/package.mjs`, `tests/xlsx-fixture.mjs`, `tests/verify-workbook.py`, and this document. Generated outputs: `artifacts/link-meteor-0.1.0.zip`, `artifacts/link-meteor-0.1.0.sha256.json`, and two fixture files under `.scratch/`. No Git changes, installation, or browser launch by this worker.

The packager reads `dist/`, checks the extension version against `package.json`, requires the exact 13-file product allowlist in both `src/` and `dist/`, and refuses stale build bytes. It creates a deterministic uncompressed ZIP with fixed entry order and timestamps. The sidecar JSON records the source Git HEAD, source-file and whole-worktree dirty flags, the ZIP SHA-256, and each packaged file's size and SHA-256. No source, docs, profile, or private test data is included in the ZIP.

Commands and results:

- `node tests/xlsx-fixture.mjs` wrote `.scratch/workbook-fixture.xlsx` and `.scratch/workbook-fixture.expected.json`: 3 representative rows from 4 occurrences, with duplicate-source provenance. Reordered columns contain an empty anchor label, Unicode, quotes/newline, a formula-like string, literal `_x0001_`, and an actual control character. The fixture writer checked that export did not mutate its input.
- Bundled Python 3.12 `tests/verify-workbook.py` reported `zip_crc=pass`, `ooxml_structure=pass`, and 3 matching rows. Bundled `openpyxl` opened the workbook. It returned the OOXML escape tokens for the literal token and control character; applying the specified OOXML escape decoding matched every expected cell. Its formula-like `=1+1` cell was a string (`data_type='s'`), and the textless anchor cell remained `''`.
- Initial `npm run package` stopped on stale `dist/core/export.js`, as designed. The driver rebuilt `dist`; the next run succeeded with 13 files, 112,574 ZIP bytes, SHA-256 `04189062256c686d1a50f573573c3ccfd0b50f94b8f9cbea8bec54a3b5b81b11`, and source Git HEAD `123da8f7cd5155924a180c6ef4fafa16fdc16adc`. The manifest records both dirty flags as `true`.
- An independent Python `zipfile`/`hashlib` check passed ZIP CRC, ordered file allowlist, every file SHA-256, and the full archive SHA-256. Repeating `npm run package` produced the same ZIP size and SHA-256.

This verifies an OOXML package structurally and through `openpyxl`; it is not a Microsoft Excel or LibreOffice application check. The workbook fixture is retained only under `.scratch`, not in the extension release ZIP.
