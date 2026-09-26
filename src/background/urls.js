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
