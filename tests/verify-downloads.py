#!/usr/bin/env python3
"""Independently compare the browser suite's actual downloaded XLSX, CSV and JSON exports.

Reads artifacts/evidence/exports/browser.{xlsx,csv,json} (written by tests/browser.mjs) with
openpyxl and Python's csv module, then writes artifacts/evidence/workbook-results.json.
This is a library-level reader check, not Microsoft Excel application acceptance.
"""
import csv
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
exports = root / "artifacts" / "evidence" / "exports"
out = root / "artifacts" / "evidence" / "workbook-results.json"


def unformula(value):
    # CSV prefixes formula-like cells with an apostrophe; the stored/JSON value has no prefix.
    return value[1:] if value.startswith("'") and value[1:2] in "=+-@\t\r" else value


def main():
    rows = json.loads((exports / "browser.json").read_text(encoding="utf-8"))
    expected = [[row["anchorText"], row["url"]] for row in rows]
    with zipfile.ZipFile(exports / "browser.xlsx") as archive:
        if archive.testzip():
            raise SystemExit("ZIP CRC failed")
        sheet = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
    string_cells = sheet.count('t="inlineStr"')
    total_cells = sheet.count("<c ")
    from openpyxl import load_workbook
    book = load_workbook(exports / "browser.xlsx", read_only=True, data_only=False)
    try:
        values = [["" if cell is None else str(cell) for cell in row] for row in book.active.values]
    finally:
        book.close()
    header, body = values[0], values[1:]
    with (exports / "browser.csv").open(newline="", encoding="utf-8") as handle:
        csv_rows = list(csv.reader(handle))
    csv_body = [[unformula(cell) for cell in row] for row in csv_rows[1:]]
    result = {
        "result": "PASS",
        "reader": "openpyxl " + __import__("openpyxl").__version__,
        "source": "actual files downloaded by tests/browser.mjs",
        "header": header,
        "actual_download_rows": len(body),
        "csv_rows": len(csv_body),
        "json_rows": len(rows),
        "exact_anchor_url_pairs": body == expected,
        "csv_matches_json_after_formula_prefix": csv_body == expected,
        "empty_anchor_rows": sum(1 for anchor, _ in expected if anchor == ""),
        "formula_like_rows": sum(1 for anchor, _ in expected if anchor[:1] in "=+-@"),
        "xlsx_all_string_cells": string_cells == total_cells,
        "excel_application_tested": False,
    }
    if not (result["exact_anchor_url_pairs"] and result["csv_matches_json_after_formula_prefix"] and result["xlsx_all_string_cells"] and header == ["Anchor text", "URL"]):
        result["result"] = "FAIL"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
