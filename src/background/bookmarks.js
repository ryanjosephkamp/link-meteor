// Bookmarks: saving links as a Chrome bookmark folder.
import {validWebUrls} from './urls.js';

export async function bookmarkLinks(name, links) {
  if (!(await chrome.permissions.contains({permissions:['bookmarks']}))) throw new Error('Allow bookmark access before saving a folder.');
  if (!Array.isArray(links) || links.length > 20000) throw new Error('Choose at most 20,000 bookmarks per folder.');
  validWebUrls(links.map(link => link.url));
  const title = String(name || '').trim();
  if (!title) throw new Error('Enter a bookmark folder name.');
  const folder = await chrome.bookmarks.create({title});
  let count = 0, failed = 0;
  for (const link of links) {
    try { await chrome.bookmarks.create({parentId:folder.id,title:String(link.anchorText || link.url),url:link.url}); count++; }
    catch { failed++; }
  }
  return {folderId:folder.id,count,failed};
}

// Messages this module answers. Like every table here, they are accepted only from the workbench.
export const workbenchMessages = {
  'links.bookmark': (message) => bookmarkLinks(message.name,message.links),
};
