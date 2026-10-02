// URL rules shared by capture, opening links and bookmarks.
export function ordinaryUrl(value) {
  try {
    const url = new URL(value);
    return ['http:','https:'].includes(url.protocol) && url.hostname !== 'chromewebstore.google.com'
      && !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function validWebUrls(urls) {
  if (!Array.isArray(urls) || urls.some(url => { try { return !['http:','https:'].includes(new URL(url).protocol); } catch { return true; } })) {
    throw new Error('Only HTTP and HTTPS links can be opened or bookmarked in a batch.');
  }
  return urls;
}

// What a tab's address says it holds: 'pdf' (a PDF on the web), 'pdf-file' (a PDF opened from the
// computer), 'file' (another file there) or ''. A PDF whose address doesn't end in .pdf is found
// by asking the tab (background.js).
export function addressKind(value) {
  let url = null;
  try { url = new URL(value); } catch { return ''; }
  const pdf = /\.pdf$/i.test(url.pathname);
  if (url.protocol === 'file:') return pdf ? 'pdf-file' : 'file';
  return pdf && ['http:', 'https:'].includes(url.protocol) ? 'pdf' : '';
}

// What Link Meteor says where a region can't be drawn or a page's links can't be read. 0.6.0: the
// links inside a PDF are read in the side panel (Capture this PDF, or the file itself for a PDF
// opened from the computer), so these say where to go.
export const PDF_REGION_REFUSAL = 'Regions can’t be drawn on a PDF. Open Link Meteor’s side panel and choose Capture this PDF.';
export const PDF_FILE_REGION_REFUSAL = 'Regions can’t be drawn on a PDF. Open Link Meteor’s side panel and choose the PDF’s file there.';
export const FILE_REFUSAL = 'Link Meteor can’t capture from files on your computer. To save one link, right-click it and choose Link Meteor, then Add link.';
// A PDF among the tabs of a capture is not an error: its links are read by themselves.
export const PDF_TAB_NOTE = 'A PDF: capture it by itself with Capture this PDF.';
export const PDF_FILE_NOTE = 'A PDF on your computer: choose its file with Import links.';
export function captureRefusal(value) {
  const kind = addressKind(value);
  return kind === 'pdf' ? PDF_REGION_REFUSAL : kind === 'pdf-file' ? PDF_FILE_REGION_REFUSAL : kind === 'file' ? FILE_REFUSAL
    : 'Chrome does not allow link capture on this page. Choose an ordinary HTTP or HTTPS webpage.';
}
