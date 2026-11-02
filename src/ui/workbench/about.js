// About and help: the version, the help button, Copy diagnostics, and website links that open in
// the chosen theme.
import { THEME_IDS } from '../../core/themes.js';
import { $ } from './helpers.js';
import { ui, action, request, show } from './state.js';
import { setView, onRender } from './rendering.js';

export function showVersion() {
  const version = chrome.runtime?.getManifest?.().version || '';
  $('about-version').textContent = version ? `v${version}` : '';
  $('about-version-full').textContent = version ? `version ${version}` : '';
}

// A Link Meteor website address with ?theme=<id>, so the site opens in the same theme. Meteor,
// the default, and an unknown theme add nothing.
export function themedSiteLink(href, theme) {
  if (theme === 'meteor' || !THEME_IDS.includes(theme)) return href;
  const url = new URL(href);
  url.searchParams.set('theme', theme);
  return url.href;
}

// Runs on every render, so a theme change reaches the links at once.
export function renderSiteLinks() {
  const theme = ui.state?.settings?.theme;
  for (const link of document.querySelectorAll('#about-panel a[data-site-link]')) {
    link.dataset.siteLink ||= link.getAttribute('href');
    link.href = themedSiteLink(link.dataset.siteLink, theme);
  }
}

// Diagnostics hold counts, choices and browser facts only (background/diagnostics.js).
export async function copyDiagnostics() {
  const report = await request({ type: 'diagnostics.get' });
  await navigator.clipboard.writeText(`${JSON.stringify(report, null, 2)}\n`);
  show('Copied diagnostics as indented JSON: versions, settings, permissions and counts. Paste them into your bug report.');
}

export function bindAbout() {
  // About and help lives at the foot of the collections rail; the header button reveals it in either layout.
  $('help-toggle').addEventListener('click', (event) => {
    $('about-panel').open = true;
    if (!matchMedia('(min-width: 900px)').matches) setView('collections', event.currentTarget);
    $('about-summary').scrollIntoView({ block: 'nearest' });
    $('about-summary').focus({ preventScroll: true });
  });
  $('copy-diagnostics').addEventListener('click', () => action(copyDiagnostics));
  onRender(renderSiteLinks);
}
