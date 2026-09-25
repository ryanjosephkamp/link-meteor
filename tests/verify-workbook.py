#!/usr/bin/env python3
"""Independently inspect the generated OOXML workbook and, when present, open it with openpyxl."""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def fail(message):
    raise SystemExit(message)


def decode_ooxml(value):
    # One pass: _x005F_x0001_ becomes the literal text _x0001_, not a control.
    return re.sub(r"_x([0-9A-Fa-f]{4})_", lambda match: chr(int(match.group(1), 16)), value)


def verify(xlsx_path, expected_path):
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(xlsx_path) as archive:
        bad = archive.testzip()
        if bad:
            fail(f"ZIP CRC failed: {bad}")
        required = {
            "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml",
        }
        if not required.issubset(archive.namelist()):
            fail("Missing OOXML workbook entries")
        for name in required:
            ElementTree.fromstring(archive.read(name))
        sheet = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    structural_rows = []
    for row in sheet.findall(f"./{namespace}sheetData/{namespace}row"):
        cells = []
        for cell in row.findall(f"./{namespace}c"):
            if cell.get("t") != "inlineStr":
                fail(f"Unsafe/non-string cell at {cell.get('r')}")
            value = cell.find(f"./{namespace}is/{namespace}t")
            cells.append(decode_ooxml(value.text or "") if value is not None else "")
        structural_rows.append(cells)
    if structural_rows != expected["rows"]:
        fail(f"OOXML cell mismatch: {structural_rows!r} != {expected['rows']!r}")

    result = {"zip_crc": "pass", "ooxml_structure": "pass", "rows": len(structural_rows) - 1}
    try:
        from openpyxl import load_workbook
    except ImportError:
        result["openpyxl"] = "unavailable; structural ZIP/XML verification only"
    else:
        book = load_workbook(xlsx_path, read_only=True, data_only=False)
        try:
            raw_rows = [[str(cell) if cell is not None else "" for cell in row] for row in book.active.values]
        finally:
            book.close()
        if raw_rows == expected["rows"]:
            result["openpyxl"] = "opened; exact cell values matched"
        elif [[decode_ooxml(cell) for cell in row] for row in raw_rows] == expected["rows"]:
            result["openpyxl"] = "opened; OOXML escaped strings required decoding for exact match"
        else:
            fail(f"openpyxl cell mismatch: {raw_rows!r} != {expected['rows']!r}")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        fail("usage: verify-workbook.py XLSX EXPECTED_JSON")
    verify(Path(sys.argv[1]), Path(sys.argv[2]))
