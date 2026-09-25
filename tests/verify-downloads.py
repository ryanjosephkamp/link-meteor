#!/usr/bin/env python3
"""Independently read the browser suite's seven actual downloaded export formats.

Reads artifacts/evidence/exports/browser.{xlsx,csv,json} (written by tests/browser.mjs) with
openpyxl and Python's csv module, then writes artifacts/evidence/workbook-results.json.
This is a library-level reader check, not Microsoft Excel application acceptance.
"""
import csv
import json
import os
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parents[1]
evidence = root / os.environ.get("LINK_METEOR_EVIDENCE_DIR", "artifacts/evidence")
exports = evidence / "exports"
out = evidence / "workbook-results.json"


class TableReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.current, self.cell = [], [], None
        self.unexpected_tags = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current = []
        if tag in ("td", "th"):
            self.cell = ""
        if tag not in ("html", "meta", "title", "table", "thead", "tbody", "tr", "td", "th"):
            self.unexpected_tags.append(tag)

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.current.append(self.cell)
            self.cell = None
        if tag == "tr":
            self.rows.append(self.current)


def unformula(value):
    # CSV prefixes formula-like cells with an apostrophe; the stored/JSON value has no prefix.
    return value[1:] if value.startswith("'") and value[1:2] and value[1:2] in "=+-@\t\r" else value


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
    with (exports / "browser.tsv").open(newline="", encoding="utf-8") as handle:
        tsv_rows = list(csv.reader(handle, delimiter="\t"))
    tsv_body = [[unformula(cell) for cell in row] for row in tsv_rows[1:]]
    html = TableReader()
    html.feed((exports / "browser.html").read_text(encoding="utf-8"))
    markdown = []
    for line in (exports / "browser.md").read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\[(.*)\]\((.*)\)", line)
        if not match:
            raise ValueError("Malformed Markdown link")
        markdown.append([re.sub(r"\\(.)", r"\1", match[1]), match[2]])
    markdown_expected = [[re.sub(r"[\r\n]+", " ", anchor), re.sub(r"[<>()[\]\\]", lambda m: f"%{ord(m[0]):02X}", url)] for anchor, url in expected]
    text_urls = (exports / "browser.txt").read_text(encoding="utf-8").splitlines()
    result = {
        "result": "PASS",
        "reader": "openpyxl " + __import__("openpyxl").__version__,
        "source": os.environ.get("LINK_METEOR_DOWNLOAD_SOURCE", "actual files downloaded by tests/browser.mjs"),
        "header": header,
        "actual_download_rows": len(body),
        "csv_rows": len(csv_body),
        "json_rows": len(rows),
        "exact_anchor_url_pairs": body == expected,
        "csv_matches_json_after_formula_prefix": csv_body == expected,
        "tsv_matches_json_after_formula_prefix": tsv_body == expected,
        "html_exact_pairs_no_injected_markup": html.rows == [["Anchor text", "URL"], *expected] and not html.unexpected_tags,
        "markdown_pairs_with_single_line_labels": markdown == markdown_expected,
        "text_exact_urls": text_urls == [url for _, url in expected],
        "empty_anchor_rows": sum(1 for anchor, _ in expected if anchor == ""),
        "formula_like_rows": sum(1 for anchor, _ in expected if anchor and anchor[:1] in "=+-@"),
        "xlsx_all_string_cells": string_cells == total_cells,
        "excel_application_tested": False,
    }
    if not (all(result[key] for key in ["exact_anchor_url_pairs", "csv_matches_json_after_formula_prefix", "tsv_matches_json_after_formula_prefix", "html_exact_pairs_no_injected_markup", "markdown_pairs_with_single_line_labels", "text_exact_urls", "xlsx_all_string_cells"]) and header == ["Anchor text", "URL"] and csv_rows[0] == header and tsv_rows[0] == header):
        result["result"] = "FAIL"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
