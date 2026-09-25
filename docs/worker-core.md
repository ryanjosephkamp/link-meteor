# Task 1 core worker handback

Changed only `src/core/model.js`, `src/core/export.js`, `src/core/xlsx.js`, `tests/core.test.mjs`, `tests/export.test.mjs`, and this file. No commit or push.

`model.js` implements fresh collection state, all contracted reducer actions, immutable append/remove/undo/update, validation of link shape and HTTP(S), `mailto:`, or `tel:` destinations, and reversible filter/sort/dedup views. Dedupe rows retain every matching occurrence, its ID, anchor text, and source metadata. Duplicate occurrence IDs are skipped globally, including IDs waiting in the undo snapshot; shared destination URLs are never collapsed in storage.

`export.js` provides the contracted formats and ordered columns. CSV/TSV quote cells and prefix formula-like values; XLSX stores all cells as inline strings. Text preserves valid HTTP(S), `mailto:`, and `tel:` URL strings exactly. Markdown validates those schemes and escapes labels and URL delimiters. HTML escapes all cell content. JSON serializes full representative rows and grouped provenance, regardless of selected columns. `xlsx.js` writes a five-entry uncompressed OOXML ZIP with CRC-32 checksums.

Checks actually run:

- Before implementation, `node --test tests/core.test.mjs` failed because the test file did not exist. After writing tests but before modules, `node --test tests/core.test.mjs tests/export.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for both modules.
- Final `node --test tests/core.test.mjs tests/export.test.mjs`: 8 passed, 0 failed.
- A generated workbook was piped to Python standard-library `zipfile` and `ElementTree`. `testzip()` returned `None` (no CRC failure); the expected five OOXML entries and ordered headers, `=1+1`, URL, and Unicode cell values were read successfully.

Limit: `openpyxl` is not installed in the available Python interpreter (`ModuleNotFoundError`), so a full spreadsheet-library open was not performed by this worker. The driver plans independent workbook acceptance. No other known core defect remains from the focused tests.

## Integration follow-up

The UI integration found that capture includes `mailto:` and `tel:` destinations. The model now accepts and preserves those alongside HTTP(S), while still rejecting `javascript:` and `data:`. Text export returns each valid original URL string unchanged; Markdown alone percent-encodes URL delimiters. The XLSX writer now correctly escapes a literal `_xNNNN_` token as `_x005F_xNNNN_`. A new test checks control-character, Unicode, and literal-token roundtrip using OOXML escape decoding, and verifies column `AA` after `Z`. All changes remain in the original six owned files.

Before this follow-up, the original suite passed 8/8. The three new regression tests failed against the old implementation as expected. After the change, `node --test tests/core.test.mjs tests/export.test.mjs` passed 11/11 with no failures. Browser opening and bookmark creation remain the background layer's HTTP(S)-only responsibility; this worker did not edit that layer.
