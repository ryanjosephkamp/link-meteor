// Insights (0.5.0): the list heading's Links or Insights switch, and the Insights cards for the
// whole collection. Every count comes from insights() in core/insights.js. The cards are drawn
// again only when the collection changes while Insights is shown, or when it opens. Choosing a
// site, file type, reading status or Starred shows those links in the list, as a view option.
import { insights } from '../../core/insights.js';
import { $, node, count, plural } from './helpers.js';
import { renderLinks, showOnly } from './review.js';

const SITES_SHOWN = 8;
const STATUS_LABELS = [['unread', 'Unread'], ['reading', 'Reading'], ['read', 'Read']];
let shown = false;
let drawnKey = '';

export function insightsShown() { return shown; }

// Switches between the list and Insights. Callers render afterwards (renderLinks draws both).
export function setInsights(on) {
  shown = on;
  $('review').classList.toggle('is-insights', on);
  $('insights').hidden = !on;
  $('show-links').setAttribute('aria-pressed', String(!on));
  $('show-insights').setAttribute('aria-pressed', String(on));
  $('review-title').textContent = on ? 'Insights' : 'Links';
}

// Runs after every list render. An empty collection has nothing to count, so it shows the list.
export function renderInsights(collection) {
  if (shown && !collection.links.length) { setInsights(false); return; }
  if (!shown) return;
  $('result-count').textContent = 'For the whole collection';
  const key = `${collection.id}\n${collection.updatedAt}\n${collection.links.length}`;
  if (key === drawnKey) return;
  drawnKey = key;
  // Keyboard focus stays on the same choice when the cards are drawn again.
  const focused = document.activeElement?.closest?.('#insights [data-choice]')?.dataset.choice;
  const data = insights(collection.links, { pages: collection.pages || {}, limit: 12 });
  $('insights').replaceChildren(
    totals(data), card('Top sites', siteList(data)), card('File types', typeList(data)), card('Other sites or the same site', relation(data)),
    card('Reading', statusList(data)), card('Saved more than once', repeats(data), 'wide'), card('Captures over time, by week', timeline(data), 'wide'),
    chooseHelp());
  if (focused) [...$('insights').querySelectorAll('[data-choice]')].find((item) => item.dataset.choice === focused)?.focus({ preventScroll: true });
}

function card(title, content, wide = '') {
  const section = node('section', `insight${wide ? ' wide' : ''}`);
  const heading = node('h3', '', title); heading.id = `insight-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading, ...[content].flat());
  return section;
}

// A control that shows some links in the list. data-choice keeps focus across redraws.
function chooser(tag, choice, className) {
  const item = node(tag, className);
  if (tag === 'button') { item.type = 'button'; item.dataset.choice = JSON.stringify(choice); item.setAttribute('aria-describedby', 'insights-choose-help'); item.addEventListener('click', () => choose(choice)); }
  return item;
}

function choose(choice) {
  setInsights(false);
  showOnly(choice);
  $('show-links').focus();
}

function chooseHelp() {
  const help = node('p', 'sr-only', 'Shows these links in the list.'); help.id = 'insights-choose-help';
  return help;
}

function totals(data) {
  const section = node('section', 'insight wide'); section.setAttribute('aria-label', 'Totals');
  const list = node('ul', 'totals');
  const items = [[data.total, 'link', 'links'], [data.uniqueUrls, 'unique address', 'unique addresses'], [data.sites, 'site', 'sites'],
    [data.sourcePages, 'page captured from', 'pages captured from'], [data.withIdentifier, 'with an identifier', 'with an identifier'], [data.starred, 'starred', 'starred', { starred: true }]];
  for (const [n, one, many, choice] of items) {
    const item = node('li');
    const total = chooser(choice && n ? 'button' : 'div', choice, 'total');
    total.append(node('b', '', count(n)), ' ', node('span', '', n === 1 ? one : many));
    item.append(total); list.append(item);
  }
  section.append(list);
  return section;
}

// Rows with a count and a bar drawn to scale against the largest; rows with a choice are buttons.
function bars(items) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const list = node('ul', 'bars');
  for (const item of items) {
    const row = chooser(item.choice && item.count ? 'button' : 'div', item.choice, 'bar-row');
    const bar = node('span', 'bar'); bar.setAttribute('aria-hidden', 'true');
    const fill = node('i'); fill.style.width = `${(item.count / max) * 100}%`; bar.append(fill);
    row.append(node('span', 'label', item.label), ' ', node('span', 'num', count(item.count)), node('span', 'sr-only', item.count === 1 ? ' link' : ' links'), bar);
    row.title = item.title || item.label;
    const li = node('li'); li.append(row); list.append(li);
  }
  return list;
}

function siteList(data) {
  if (!data.topSites.length) return node('p', 'note', 'No links to websites yet.');
  const sites = data.topSites.slice(0, SITES_SHOWN);
  const note = data.sites > sites.length ? `The ${sites.length} sites with the most links, of ${plural(data.sites, 'site')}. Choose a site to show its links.` : 'Choose a site to show its links.';
  return [bars(sites.map((site) => ({ label: site.host, count: site.count, choice: { site: site.host } }))), node('p', 'note', note)];
}

function typeList(data) {
  return [bars(data.fileTypes.map((type) => ({ label: type.group, count: type.count, choice: { typeGroup: type.group } }))), node('p', 'note', 'Choose a type to show its links.')];
}

function statusList(data) {
  return [bars(STATUS_LABELS.map(([status, label]) => ({ label, count: data.status[status], choice: { status } }))), node('p', 'note', 'Choose a status to show its links.')];
}

function relation(data) {
  const { other, same, unknown } = data.relation;
  const percent = (n) => `${Math.round((n / Math.max(1, data.total)) * 100)}%`;
  const split = node('div', 'split-bar'); split.setAttribute('aria-hidden', 'true');
  for (const [n, className] of [[other, 'a'], [same, 'b']]) { const part = node('i', className); part.style.width = percent(n); split.append(part); }
  const legend = node('ul', 'legend');
  legend.append(node('li', 'a', `Other sites ${count(other)} (${percent(other)})`), node('li', 'b', `Same site as the page ${count(same)} (${percent(same)})`));
  if (unknown) legend.append(node('li', 'c', `Email, phone or no source page ${count(unknown)} (${percent(unknown)})`));
  return [split, legend];
}

function repeats(data) {
  const { addresses, differentLabels, top } = data.repeats;
  if (!addresses) return node('p', 'note', 'No address was saved more than once.');
  const list = bars(top.map((entry) => ({ label: entry.anchorText || entry.url, count: entry.count, title: entry.url })));
  return [list, node('p', 'note', `${plural(addresses, 'address', 'addresses')} ${addresses === 1 ? 'was' : 'were'} saved more than once; ${count(differentLabels)} of them under different anchor text.`)];
}

// Weekly columns drawn to scale against the busiest week, with the weeks as text for screen readers.
function timeline(data) {
  const weeks = data.timeline;
  if (!weeks.length) return node('p', 'note', 'No capture times to show.');
  const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const peak = weeks.reduce((best, week) => (week.count > best.count ? week : best), weeks[0]);
  const chart = node('div', 'columns-chart'); chart.setAttribute('aria-hidden', 'true');
  for (const week of weeks) {
    const column = node('i', week === peak && peak.count ? 'peak' : '');
    column.style.height = `${(week.count / Math.max(1, peak.count)) * 100}%`;
    column.title = `Week of ${day(week.weekStart)}: ${plural(week.count, 'link')}`;
    chart.append(column);
  }
  const axis = node('div', 'chart-axis'); axis.setAttribute('aria-hidden', 'true');
  axis.append(node('span', '', day(weeks[0].weekStart)), node('span', 'peak-label', `Peak: ${plural(peak.count, 'link')}, week of ${day(peak.weekStart)}`));
  if (weeks.length > 1) axis.append(node('span', '', day(weeks.at(-1).weekStart)));
  const left = data.total - weeks.reduce((n, week) => n + week.count, 0);
  const summary = node('p', 'note', `Each column is a week, Monday to Sunday (UTC).${left ? ` ${plural(left, 'link')} from earlier weeks or without a capture time ${left === 1 ? 'isn’t' : 'aren’t'} shown.` : ''}`);
  summary.prepend(node('span', 'sr-only', `${plural(weeks.length, 'week')} from the week of ${day(weeks[0].weekStart)}. Peak: ${plural(peak.count, 'link')}, week of ${day(peak.weekStart)}. `));
  const text = node('ul', 'sr-only'); text.setAttribute('aria-label', 'Links captured each week');
  for (const week of weeks) text.append(node('li', '', `Week of ${day(week.weekStart)}: ${plural(week.count, 'link')}`));
  return [chart, axis, summary, text];
}

export function bindInsights() {
  $('show-links').addEventListener('click', () => { if (shown) { setInsights(false); renderLinks(); } });
  $('show-insights').addEventListener('click', () => { if (!shown) { setInsights(true); renderLinks(); } });
  // "/" searches the list, so from Insights it shows the list first.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || !shown || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    setInsights(false); renderLinks(); $('search').focus(); $('search').select();
  });
}
