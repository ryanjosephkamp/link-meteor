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

// Formatted workbook (0.3.0), written only when options are given: a bold header row frozen in
// place, filter buttons, fitted column widths, clickable web and mail links through sheet
// hyperlinks (never formulas) and an optional About sheet. Every cell stays an inline string
// with the text number format, so nothing is calculated or reinterpreted.
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const MAX_HYPERLINKS = 65530; // Excel's limit per worksheet
export const MAX_HYPERLINK_LENGTH = 2079; // Excel refuses longer link addresses
const STYLE = { text: 1, header: 2, link: 3 };

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// The exact cell text becomes the link target, or '' when it is not a web or mail address.
export function hyperlinkTarget(value) {
  const text = String(value ?? '');
  if (!text || text.length > MAX_HYPERLINK_LENGTH || /[\s\u0000-\u001f\u007f]/u.test(text)) return '';
  if (!/^(https?:\/\/|mailto:)/i.test(text)) return '';
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(text).protocol) ? text : ''; } catch { return ''; }
}

function wide(codePoint) {
  return (codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd);
}

// Display width in characters of the longest line, counting wide characters twice.
function textWidth(value) {
  let longest = 0;
  for (const line of String(value ?? '').split(/\r\n|\r|\n/)) {
    let width = 0;
    for (const char of line) width += wide(char.codePointAt(0)) ? 2 : 1;
    if (width > longest) longest = width;
  }
  return longest;
}

// Column widths fitted to the widest cell, between min and max characters. Bold cells (the
// header row, or the About sheet's label column) count a little wider.
export function columnWidths(rows, { boldRow = false, boldColumn = false, min = 8, max = 80 } = {}) {
  const widths = [];
  rows.forEach((values, rowIndex) => values.forEach((value, index) => {
    const bold = (boldRow && rowIndex === 0) || (boldColumn && index === 0);
    const width = bold ? Math.ceil(textWidth(value) * 1.1) : textWidth(value);
    if (!(widths[index] >= width)) widths[index] = width;
  }));
  return Array.from(widths, width => Math.min(max, Math.max(min, (width || 0) + 2)));
}

function stringCell(ref, value, style) {
  const string = String(value ?? '');
  if (string.length > 32767) throw new Error('XLSX cell exceeds Excel’s 32,767-character limit');
  const preserve = /^\s|\s$|[\r\n\t]/.test(string) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xml(string)}</t></is></c>`;
}

// One worksheet. header: bold first row, frozen, with filter buttons. labelColumn: bold first
// column (the About sheet). linkColumns: column indexes whose web and mail addresses are linked.
function formattedSheet(headers, rows, { header = false, labelColumn = false, linkColumns = [], selected = false } = {}) {
  const all = headers ? [headers, ...rows] : rows;
  const widths = columnWidths(all, { boldRow: header, boldColumn: labelColumn });
  const linked = new Set(linkColumns);
  const links = [];
  let capped = false;
  const rowXml = all.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const ref = `${col(columnIndex)}${rowIndex + 1}`;
      let style = STYLE.text;
      if ((header && rowIndex === 0) || (labelColumn && columnIndex === 0)) style = STYLE.header;
      else if (linked.has(columnIndex) && hyperlinkTarget(value)) {
        if (links.length < MAX_HYPERLINKS) { links.push([ref, hyperlinkTarget(value)]); style = STYLE.link; }
        else capped = true;
      }
      return stringCell(ref, value, style);
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const columnCount = Math.max(headers ? headers.length : 0, ...all.map(values => values.length));
  const last = `${col(Math.max(columnCount, 1) - 1)}${Math.max(all.length, 1)}`;
  const pane = header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '';
  const view = `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>`;
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const filter = header ? `<autoFilter ref="A1:${last}"/>` : '';
  const hyperlinks = links.length ? `<hyperlinks>${links.map(([ref], index) => `<hyperlink ref="${ref}" r:id="rId${index + 1}"/>`).join('')}</hyperlinks>` : '';
  const sheet = `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="A1:${last}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowXml}</sheetData>${filter}${hyperlinks}</worksheet>`;
  const rels = links.length
    ? `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${links.map(([, target], index) => `<Relationship Id="rId${index + 1}" Type="${REL}/hyperlink" Target="${attr(target)}" TargetMode="External"/>`).join('')}</Relationships>`
    : '';
  return { sheet, rels, filterRef: header ? `$A$1:$${last.replace(/(\d+)$/, '$$$1')}` : '', links: links.length, capped };
}

const STYLES = `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// headers/rows: the Links sheet. options.linkColumns: indexes of URL columns. options.about:
// [label, value] rows for a second sheet, About; omit it for a single sheet.
function writeFormattedXlsx(headers, rows, { linkColumns = [], about = null } = {}) {
  const links = formattedSheet(headers, rows, { header: true, linkColumns, selected: true });
  const aboutSheet = about ? formattedSheet(null, about, { labelColumn: true }) : null;
  const sheets = [['Links', 'sheet1.xml', links], ...(aboutSheet ? [['About', 'sheet2.xml', aboutSheet]] : [])];
  const types = sheets.map(([, file]) => `<Override PartName="/xl/worksheets/${file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookRels = sheets.map(([, file], index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/${file}"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>`;
  const files = [
    ['[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${types}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map(([name], index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Links!${links.filterRef}</definedName></definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${workbookRels}</Relationships>`],
    ['xl/styles.xml', STYLES],
  ];
  for (const [, file, sheet] of sheets) {
    files.push([`xl/worksheets/${file}`, sheet.sheet]);
    if (sheet.rels) files.push([`xl/worksheets/_rels/${file}.rels`, sheet.rels]);
  }
  return { data: zip(files), links: links.links, linksCapped: links.capped };
}

// Without options this is the 0.2.2 writer, byte for byte: one plain sheet of inline strings.
// With options it returns the formatted workbook described above.
export function writeXlsx(headers, rows, options) {
  if (options !== undefined) return writeFormattedXlsx(headers, rows, options).data;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Links" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheetXml(headers, rows)],
  ]);
}
