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

// What Link Meteor says when it can't capture a tab's page (0.5.0 RC2): for a PDF (Chrome shows it
// in its own viewer, which no extension can read) or a file on the computer, what does work instead.
export const PDF_REFUSAL = 'Link Meteor can’t read the links inside a PDF yet. To save one link, right-click it and choose Link Meteor, then Add link.';
export const FILE_REFUSAL = 'Link Meteor can’t capture from files on your computer. To save one link, right-click it and choose Link Meteor, then Add link.';
export function captureRefusal(value) {
  let url = null;
  try { url = new URL(value); } catch { /* not an address */ }
  if (url && /\.pdf$/i.test(url.pathname)) return PDF_REFUSAL;
  if (url?.protocol === 'file:') return FILE_REFUSAL;
  return 'Chrome does not allow link capture on this page. Choose an ordinary HTTP or HTTPS webpage.';
}
