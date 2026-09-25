// Small OOXML workbook writer. ZIP entries are stored (method 0), so no runtime dependency is needed.
const encoder = new TextEncoder();

function xml(value) {
  return String(value)
    .replace(/_x[0-9a-fA-F]{4}_/g, match => `_x005F_${match.slice(1)}`)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, char => `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function col(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

function sheetXml(headers, rows) {
  const rowXml = [headers, ...rows].map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const string = String(value ?? '');
      if (string.length > 32767) throw new Error('XLSX cell exceeds Excel’s 32,767-character limit');
      const preserve = /^\s|\s$|[\r\n\t]/.test(string) ? ' xml:space="preserve"' : '';
      return `<c r="${col(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t${preserve}>${xml(string)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value, true); }

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [filename, content] of files) {
    const name = encoder.encode(filename);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    let view = new DataView(local.buffer);
    u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800);
    u16(view, 8, 0); u16(view, 10, 0); u16(view, 12, 33); // stored, 1980-01-01
    u32(view, 14, crc); u32(view, 18, data.length); u32(view, 22, data.length);
    u16(view, 26, name.length); u16(view, 28, 0);
    local.set(name, 30); local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    view = new DataView(central.buffer);
    u32(view, 0, 0x02014b50); u16(view, 4, 20); u16(view, 6, 20); u16(view, 8, 0x0800);
    u16(view, 10, 0); u16(view, 12, 0); u16(view, 14, 33);
    u32(view, 16, crc); u32(view, 20, data.length); u32(view, 24, data.length);
    u16(view, 28, name.length); u32(view, 42, offset);
    central.set(name, 46); centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50); u16(view, 8, files.length); u16(view, 10, files.length);
  u32(view, 12, centralSize); u32(view, 16, offset);
  const output = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const part of [...locals, ...centrals, end]) { output.set(part, position); position += part.length; }
  return output;
}

export function writeXlsx(headers, rows) {
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Links" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheetXml(headers, rows)],
  ]);
}
