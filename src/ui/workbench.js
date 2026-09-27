// Workbench entry. Each area module binds its own controls; init runs in the original order.
import { action, reloadState, onStateStorageChange, watchStateMessages } from './workbench/state.js';
import { bindViews, hideOpenFullInTab } from './workbench/rendering.js';
import { bindAbout, showVersion } from './workbench/about.js';
import { bindCollections } from './workbench/collections.js';
import { bindReview } from './workbench/review.js';
import { bindCapture, startInventory, onCaptureStorageChange, restoreSessionReport, watchTabs } from './workbench/capture.js';
import { bindExport, renderColumns } from './workbench/export.js';
import { bindBookmarks } from './workbench/bookmarks.js';
import { bindOpen } from './workbench/open.js';
import { bindSettings, loadShortcut, renderShortcut } from './workbench/settings.js';

function bindEvents() {
  bindViews();
  bindAbout();
  bindSettings();
  bindExport();
  // Escape priority follows binding order: the open-links confirmation before the delete one.
  bindOpen();
  bindCollections();
  bindReview();
  bindCapture();
  bindBookmarks();
}

async function init() {
  bindEvents(); renderColumns();
  loadShortcut();
  hideOpenFullInTab();
  showVersion();
  await reloadState();
  await startInventory();
  chrome.storage?.onChanged?.addListener((changes, area) => { onStateStorageChange(changes, area); onCaptureStorageChange(changes, area); });
  await restoreSessionReport();
  watchStateMessages();
  watchTabs();
}

renderShortcut();
action(init);
