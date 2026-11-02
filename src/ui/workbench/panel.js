// The side panel closes when Link Meteor's toolbar icon is clicked again, and when the full view
// opens from it (0.5.0). The background tells every Link Meteor page about each toolbar click
// (panel.toggle) and about Open the full view in the toolbar's menu (panel.close), with the
// window; the side panel open in that window closes itself, with Chrome's own close where Chrome
// has one. The full view in a tab ignores both. A click that opens the panel reaches no panel,
// since the new one isn't listening yet.
function close(windowId) {
  const own = typeof chrome.sidePanel?.close === 'function' ? chrome.sidePanel.close({ windowId }) : Promise.reject(new Error('no close'));
  return own.catch(() => window.close());
}

// The side panel's window id, or null in a tab.
async function panelWindow() {
  if (await chrome.tabs?.getCurrent?.()) return null;
  return (await chrome.windows.getCurrent()).id;
}

export function closeOnToolbarClick() {
  panelWindow().then((windowId) => {
    if (windowId === null) return;
    chrome.runtime.onMessage.addListener((message) => {
      if ((message?.type === 'panel.toggle' || message?.type === 'panel.close') && message.windowId === windowId) close(windowId);
      return false;
    });
  }).catch(() => {});
}

// After the side panel's Full view button opened the full view: the panel steps aside.
export async function closeIfSidePanel() {
  const windowId = await panelWindow().catch(() => null);
  if (windowId !== null) await close(windowId);
}
