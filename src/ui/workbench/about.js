// About and help: the version and the help button.
import { $ } from './helpers.js';
import { setView } from './rendering.js';

export function showVersion() {
  const version = chrome.runtime?.getManifest?.().version || '';
  $('about-version').textContent = version ? `v${version}` : '';
  $('about-version-full').textContent = version ? `version ${version}` : '';
}

export function bindAbout() {
  // About and help lives at the foot of the collections rail; the header button reveals it in either layout.
  $('help-toggle').addEventListener('click', (event) => {
    $('about-panel').open = true;
    if (!matchMedia('(min-width: 900px)').matches) setView('collections', event.currentTarget);
    $('about-summary').scrollIntoView({ block: 'nearest' });
    $('about-summary').focus({ preventScroll: true });
  });
}
