// Bookmarks: saving links into a new or an existing Chrome bookmark folder, and listing folders.
import {validWebUrls} from './urls.js';

const PATH_SEPARATOR = ' › ';
const MAX_LINKS = 20000;

async function requireAccess(action) {
  if (!(await chrome.permissions.contains({permissions:['bookmarks']}))) throw new Error(`Allow bookmark access before ${action}.`);
}

// Every bookmark folder in tree order, without the invisible root. path joins the titles from the
// top-level folder down to this one. Folders Chrome manages by policy can't be written, so they
// and their subfolders are left out.
export async function bookmarkFolders() {
  await requireAccess('choosing a folder');
  const [root] = await chrome.bookmarks.getTree();
  const folders = [];
  const walk = (parent, titles, depth) => {
    for (const child of parent.children || []) {
      if (child.url !== undefined || child.unmodifiable) continue;
      const path = [...titles, child.title || '(untitled folder)'];
      folders.push({id:child.id,title:child.title || '',path:path.join(PATH_SEPARATOR),depth});
      walk(child, path, depth + 1);
    }
  };
  walk(root || {}, [], 0);
  return {folders};
}

async function existingFolder(folderId) {
  if (typeof folderId !== 'string' || !folderId) throw new Error('Choose a bookmark folder.');
  let node;
  try { [node] = await chrome.bookmarks.get(folderId); }
  catch { throw new Error('That bookmark folder no longer exists. Choose another folder.'); }
  if (!node) throw new Error('That bookmark folder no longer exists. Choose another folder.');
  if (node.url !== undefined) throw new Error('That is a bookmark, not a folder. Choose a folder.');
  if (!node.parentId) throw new Error('Choose a folder inside your bookmarks.');
  if (node.unmodifiable) throw new Error('Chrome manages that folder, so links can’t be added to it. Choose another folder.');
  return node;
}

// Saves links into a new folder under Other bookmarks (name) or an existing folder (options.folderId).
// With skipExisting (the default), a link whose exact URL is already a direct child of the folder
// is skipped, including one added earlier in the same action. A textless link uses its URL as its
// title. Lane 1's capture card calls this with (name, links) only.
export async function bookmarkLinks(name, links, {folderId, skipExisting = true} = {}) {
  await requireAccess('saving bookmarks');
  if (!Array.isArray(links) || links.length > MAX_LINKS) throw new Error('Choose at most 20,000 bookmarks per folder.');
  if (typeof skipExisting !== 'boolean') throw new Error('skipExisting must be true or false.');
  validWebUrls(links.map(link => link?.url));
  const hasName = name !== undefined && name !== null && name !== '';
  const hasFolder = folderId !== undefined && folderId !== null && folderId !== '';
  if (hasName && hasFolder) throw new Error('Choose a new folder name or an existing folder, not both.');
  let folder, created = false;
  if (hasFolder) folder = await existingFolder(folderId);
  else {
    const title = String(name || '').trim();
    if (!title) throw new Error('Enter a bookmark folder name.');
    folder = await chrome.bookmarks.create({title});
    created = true;
  }
  const present = new Set();
  if (skipExisting && !created) {
    for (const child of await chrome.bookmarks.getChildren(folder.id)) if (child.url !== undefined) present.add(child.url);
  }
  let count = 0, skipped = 0, failed = 0;
  for (const link of links) {
    if (skipExisting && present.has(link.url)) { skipped++; continue; }
    try {
      const node = await chrome.bookmarks.create({parentId:folder.id,title:String(link.anchorText || link.url),url:link.url});
      present.add(link.url);
      if (node?.url) present.add(node.url);
      count++;
    } catch { failed++; }
  }
  return {folderId:folder.id,created,count,skipped,failed};
}

// Messages this module answers. Like every table here, they are accepted only from the workbench.
export const workbenchMessages = {
  'links.bookmark': (message) => bookmarkLinks(message.name,message.links,{folderId:message.folderId,skipExisting:message.skipExisting ?? true}),
  'bookmarks.folders': () => bookmarkFolders(),
};
