// The side panel closes when Link Meteor's toolbar icon is clicked again (0.5.0 RC2). The
// background tells every Link Meteor page about each click, with its window; the side panel open in
// that window closes itself, with Chrome's own close where Chrome has one. The full view in a tab
// ignores it. A click that opens the panel reaches no panel, since the new one isn't listening yet.
export function closeOnToolbarClick() {
  chrome.tabs?.getCurrent?.().then(async (tab) => {
    if (tab) return;
    const { id: windowId } = await chrome.windows.getCurrent();
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'panel.toggle' || message.windowId !== windowId) return false;
      const own = typeof chrome.sidePanel?.close === 'function' ? chrome.sidePanel.close({ windowId }) : Promise.reject(new Error('no close'));
      own.catch(() => window.close());
      return false;
    });
  }).catch(() => {});
}
