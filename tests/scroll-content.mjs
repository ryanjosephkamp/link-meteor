// SIMULATION: the real page script (src/content/capture.js) loaded into pages of the local fixture
// server in Chrome for Testing, with a stub `chrome` object standing in for the extension, as
// tests/access-content.mjs does. It checks the page's part of a run (0.6.0):
// - Scroll to the end first: an endless feed, a lazy one, one that never ends (each cap), one that
//   removes old items as it scrolls, a feed that scrolls inside its own box, and a page with
//   nothing to load; the counter in the page's notice; Stop, Escape and Stop from the workbench;
//   scrolling back to where the person was;
// - the page's Next link in its many spellings, and pages without one;
// - the run's notice from the background (content.run), at 320 px, with its text contrast in a
//   light and a dark theme.
// Nothing is saved and nothing leaves the fixture server.
//   node tests/scroll-content.mjs
// Writes scroll-content-results.json to LINK_METEOR_EVIDENCE_DIR (default .scratch/evidence-scroll-content).
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromePath, fixtureServer, headlessArgs, playwright, root} from './helpers/browser.mjs';
import {cardTheme} from '../src/core/themes.js';

const evidence = resolve(root, process.env.LINK_METEOR_EVIDENCE_DIR || '.scratch/evidence-scroll-content');
const source = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');
const result = {started: new Date().toISOString(), kind: 'simulation: real page script, stub chrome object, in Chrome for Testing', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The stub records every message the page sends and lets the check deliver the background's.
function stub() {
  const sent = [];
  let listener = null;
  window.chrome = {
    runtime: {
      sendMessage: async (message) => { sent.push(JSON.parse(JSON.stringify(message))); return {ok: true, data: message.type === 'settings.get' ? {holdKey: 'z', holdTrigger: 'letter', holdScope: 'sites', holdOrigins: [], holdExceptions: []} : {}}; },
      onMessage: {addListener: (fn) => { listener = fn; }, removeListener() {}},
    },
    storage: {onChanged: {addListener() {}, removeListener() {}}},
  };
  window.__stub = {sent, deliver: (message) => listener?.(message, {id: 'stub'}, () => {})};
}

const fixture = await fixtureServer();
const browser = await playwright.chromium.launch({executablePath: chromePath(), headless: true, args: headlessArgs()});
const feed = (query = '') => `/site/runs/feed.html${query ? `?${query}` : ''}`;
const listing = (query = '') => `/site/runs/page.html${query ? `?${query}` : ''}`;
async function open(context, path) {
  const page = await context.newPage();
  page.on('pageerror', (error) => { throw error; });
  await page.addInitScript(stub);
  await page.goto(fixture.base + path);
  await page.addScriptTag({content: source});
  await page.waitForFunction(() => window.__stub.sent.some((message) => message.type === 'settings.get'));
  return page;
}
// The run's notice on the page: its text, and which of its buttons show.
const notice = (page) => page.evaluate(() => {
  const root = document.getElementById('link-meteor-run-notice')?.shadowRoot;
  return root ? {text: root.querySelector('.run-text').textContent, stop: !root.querySelector('.run-stop').hidden, stopDisabled: root.querySelector('.run-stop').disabled, close: !root.querySelector('.run-close').hidden} : null;
});
const sent = (page, type) => page.evaluate((type) => window.__stub.sent.filter((message) => message.type === type), type);
// Starts a scroll in the page and leaves it running; `finished(page)` waits for its answer.
const start = (page, scroll = {runId: 'run-1'}, context = false) => page.evaluate(([scroll, context]) => { window.__scan = globalThis.__linkMeteor.scan({context, scroll}); window.__scan.then((answer) => { window.__answer = answer; }); }, [scroll, context]);
const finished = async (page, timeout = 150000) => { await page.waitForFunction(() => window.__answer, null, {timeout}); return page.evaluate(() => window.__answer); };
const scan = async (page, scroll, context) => { await start(page, scroll, context); return finished(page); };
const notes = (links) => links.filter((link) => /^Field note \d+$/.test(link.anchorText)).map((link) => Number(link.anchorText.slice(11)));
const range = (to) => Array.from({length: to}, (_, i) => i + 1);

try {
  await mkdir(evidence, {recursive: true});
  const context = await browser.newContext({viewport: {width: 1100, height: 700}});

  /* An endless feed: every batch is read, and the page goes back to where it was. */
  let page = await open(context, feed('batches=4'));
  const plain = await page.evaluate(() => globalThis.__linkMeteor.scan({context: false}));
  assert.equal(plain.links.length, 21, 'without scrolling: the first batch and the navigation link');
  assert.equal(plain.scroll, undefined);
  await page.evaluate(() => scrollTo(0, 140));
  await start(page, {runId: 'run-1'}, true);
  await page.waitForFunction(() => /^Scrolling: screen \d+ of up to 50 · \d+ links$/.test(document.getElementById('link-meteor-run-notice')?.shadowRoot.querySelector('.run-text').textContent || ''));
  assert.deepEqual({...(await notice(page)), text: ''}, {text: '', stop: true, stopDisabled: false, close: false}, 'the notice has one Stop button while scrolling');
  assert.equal(await page.evaluate(() => document.getElementById('link-meteor-run-notice').shadowRoot.querySelector('.run-text').getAttribute('role')), 'status');
  let answer = await finished(page);
  assert.deepEqual(notes(answer.links), range(40), 'all four batches, in order, each once');
  assert.equal(answer.links.length, 81);
  assert.equal(answer.scroll.ended, 'end');
  assert.match(answer.scroll.text, /^Reached the end after \d+ screens\.$/);
  assert.equal(answer.scroll.of, 50);
  assert.ok(answer.scroll.screens > 2 && answer.scroll.screens < 12, `screens: ${answer.scroll.screens}`);
  assert.equal(answer.links.filter((link) => link.pageChrome).length, 1, 'the navigation link is marked as page chrome, as in a plain scan');
  assert.match(answer.links.find((link) => link.anchorText === 'its data').context, /^Observation 1, written the same day, with its data\.$/);
  // A scan's answer (with what the frames reader needs: at, capped, frames, malformed, title, url), and how the scroll went.
  assert.deepEqual(Object.keys(answer).sort(), ['at', 'capped', 'frames', 'inaccessibleFrames', 'links', 'malformed', 'page', 'scroll', 'title', 'url', 'warnings'], 'the answer is a scan’s, with how the scroll went');
  assert.equal(await page.evaluate(() => scrollY), 140, 'scrolled back to where the person was');
  const counters = await sent(page, 'run.scroll');
  assert.ok(counters.length >= answer.scroll.screens && counters.every((message) => message.runId === 'run-1' && message.of === 50));
  assert.deepEqual(counters.map((message) => message.screen), [...counters.map((message) => message.screen)].sort((a, b) => a - b), 'the counter only goes up');
  assert.equal(counters.at(-1).links, 81);
  assert.deepEqual(await notice(page), {text: `${answer.scroll.text} 81 links found.`, stop: false, stopDisabled: false, close: true}, 'afterward the notice says how it ended');
  assert.equal((await page.evaluate(() => globalThis.__linkMeteor.scan({context: false}))).links.length, 81, 'the notice itself is never read as a link');
  pass('An endless feed: Scroll to the end first reads every batch once, shows its counter with Stop, and scrolls back', {links: answer.links.length, screens: answer.scroll.screens});
  await page.close();

  /* A lazy feed: each batch takes a while to arrive. */
  for (const delay of [900, 1500]) {
    page = await open(context, feed(`batches=3&delay=${delay}`));
    answer = await scan(page, {runId: 'run-lazy'});
    assert.deepEqual(notes(answer.links), range(30), `a feed that answers after ${delay} ms`);
    assert.equal(answer.scroll.ended, 'end');
    await page.close();
  }
  pass('A lazy feed: batches that take 900 ms and 1,500 ms to arrive are waited for');

  /* A page with nothing to load, and one that scrolls inside its own box. */
  page = await open(context, listing('of=1'));
  let began = Date.now();
  answer = await scan(page, {runId: 'run-short'});
  assert.deepEqual([answer.scroll.ended, answer.scroll.screens, answer.scroll.text, answer.links.length], ['end', 1, 'Reached the end after 1 screen.', 12]);
  assert.ok(Date.now() - began < 5000, 'a page with nothing more ends after three quiet steps');
  await page.close();
  page = await open(context, feed('batches=4&box=1'));
  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 60; });
  answer = await scan(page, {runId: 'run-box'});
  assert.deepEqual(notes(answer.links), range(40), 'a feed in its own scrolling box');
  assert.equal(await page.evaluate(() => document.getElementById('scroller').scrollTop), 60, 'the box goes back to where it was');
  pass('A page with nothing to load ends at once; a feed that scrolls inside its own box is scrolled there');
  await page.close();

  /* A feed that removes old items as it scrolls: what it removed is kept. */
  page = await open(context, feed('batches=5&keep=15'));
  answer = await scan(page, {runId: 'run-keep'});
  assert.deepEqual(notes(answer.links), range(50), 'every item, although the page holds only the last 15');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.item').length), 15);
  assert.equal(answer.links.length, 101);
  pass('A feed that removes old items as it scrolls: links the page removed are kept, none twice', {links: answer.links.length});
  await page.close();

  /* A feed that never ends: each cap, in its own words. */
  page = await open(context, feed('batches=inf'));
  began = Date.now();
  answer = await scan(page, {runId: 'run-screens', limits: {screens: 500, links: 1000000, ms: 100000000}});
  assert.deepEqual([answer.scroll.ended, answer.scroll.screens, answer.scroll.of, answer.scroll.text], ['screens', 50, 50, 'Stopped at 50 screens. The page may have more.'], 'a caller can’t raise the cap');
  assert.ok(answer.links.length > 400);
  assert.match((await notice(page)).text, /^Stopped at 50 screens\. The page may have more\. [\d,]+ links found\.$/);
  pass('A feed that never ends stops at 50 screens, and says the page may have more', {seconds: Math.round((Date.now() - began) / 1000), links: answer.links.length});
  await page.close();
  page = await open(context, feed('batches=inf&extra=98'));
  answer = await scan(page, {runId: 'run-links'});
  assert.deepEqual([answer.scroll.ended, answer.links.length, answer.scroll.text], ['links', 5000, 'Stopped at 5,000 links. The page may have more.']);
  await page.close();
  page = await open(context, feed('batches=inf'));
  began = Date.now();
  answer = await scan(page, {runId: 'run-time', limits: {ms: 3000}});
  assert.deepEqual([answer.scroll.ended, answer.scroll.text], ['time', 'Stopped after 3 seconds. The page may have more.']);
  assert.ok(Date.now() - began < 8000);
  assert.match(source, /const SCROLL=\{screens:50,links:5000,ms:120000,settle:600,grow:2000,still:3,poll:200\};/, 'the limits a run has: 50 screens, 5,000 links, 2 minutes');
  pass('It also stops at 5,000 links, and when its time is up (2 minutes; checked here with a lowered limit)');
  await page.close();

  /* Stop on the page, Escape, and Stop from the workbench. */
  for (const how of ['the Stop button', 'Escape', 'Stop in the workbench']) {
    page = await open(context, feed('batches=inf'));
    await page.evaluate(() => scrollTo(0, 90));
    await start(page, {runId: 'run-stop'});
    await page.waitForFunction(() => /screen [3-9] of/.test(document.getElementById('link-meteor-run-notice')?.shadowRoot.querySelector('.run-text').textContent || ''));
    if (how === 'the Stop button') await page.evaluate(() => document.getElementById('link-meteor-run-notice').shadowRoot.querySelector('.run-stop').click());
    else if (how === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => window.__stub.deliver({type: 'content.run', runId: 'run-stop', halt: true}));
    answer = await finished(page, 5000);
    assert.equal(answer.scroll.ended, 'stopped', how);
    assert.match(answer.scroll.text, /^Stopped at screen \d+: you pressed Stop\. The page may have more\.$/);
    assert.ok(answer.links.length >= 41, 'what it had is kept');
    assert.equal(await page.evaluate(() => scrollY), 90, 'scrolled back');
    // The page tells the background, unless the background told the page.
    assert.deepEqual(await sent(page, 'run.stop'), how === 'Stop in the workbench' ? [] : [{type: 'run.stop', runId: 'run-stop'}]);
    assert.equal((await notice(page)).stop, false);
    await page.close();
  }
  pass('Stop on the page, Escape, and Stop from the workbench each end the scroll at once, keep what it had, and scroll back');

  /* Inside a longer run: the run's own counter leads, and the notice stays for the next page. */
  page = await open(context, feed('batches=2'));
  await start(page, {runId: 'run-next', lead: 'Following Next: page 2 of up to 20 · ', links: 200});
  await page.waitForFunction(() => /^Following Next: page 2 of up to 20 · screen \d+ of up to 50 · 2\d\d links$/.test(document.getElementById('link-meteor-run-notice')?.shadowRoot.querySelector('.run-text').textContent || ''));
  answer = await finished(page);
  assert.equal(answer.links.length, 41);
  assert.deepEqual({...(await notice(page)), text: ''}, {text: '', stop: true, stopDisabled: false, close: false}, 'the notice keeps Stop: the run goes on');
  assert.match((await notice(page)).text, /· 241 links$/);
  // The background's own messages: the next counter, then how the run ended.
  await page.evaluate(() => window.__stub.deliver({type: 'content.run', runId: 'run-next', text: 'Following Next: page 3 of up to 20 · 241 links'}));
  assert.deepEqual(await notice(page), {text: 'Following Next: page 3 of up to 20 · 241 links', stop: true, stopDisabled: false, close: false});
  await page.keyboard.press('Escape');
  assert.deepEqual(await sent(page, 'run.stop'), [{type: 'run.stop', runId: 'run-next'}], 'Escape stops a run that is between pages');
  assert.deepEqual(await notice(page), {text: 'Stopping…', stop: true, stopDisabled: true, close: false});
  await page.evaluate(() => window.__stub.deliver({type: 'content.run', runId: 'run-next', done: true, text: 'Followed Next through 2 pages: added 241 links to “My research”. You pressed Stop.'}));
  assert.deepEqual(await notice(page), {text: 'Followed Next through 2 pages: added 241 links to “My research”. You pressed Stop.', stop: false, stopDisabled: false, close: true});
  await page.keyboard.press('Escape');
  assert.equal((await sent(page, 'run.stop')).length, 1, 'Escape does nothing once the run is over');
  await page.evaluate(() => document.getElementById('link-meteor-run-notice').shadowRoot.querySelector('.run-close').click());
  assert.equal(await notice(page), null, 'Close removes the notice');
  await page.evaluate(() => window.__stub.deliver({type: 'content.run', runId: 'run-next', done: true, text: 'Run finished.'}));
  await sleep(8600);
  assert.equal(await notice(page), null, 'the notice closes itself once the run is over');
  pass('Inside a longer run the notice shows the run’s counter and keeps Stop; the background’s messages update it; Escape stops the run; afterward it closes itself');
  await page.close();

  /* Next, in its many spellings. */
  page = await open(context, listing());
  const next = async (query) => { await page.goto(fixture.base + listing(query)); await page.addScriptTag({content: source}); return page.evaluate(() => globalThis.__linkMeteor.next()); };
  const second = (query) => `${fixture.base}/site/runs/page.html?${new URLSearchParams([...new URLSearchParams(query).entries(), ['p', '2']].filter(([key], index, all) => key !== 'p' || index === all.length - 1))}`;
  const spellings = {'rel-link': 'rel', 'rel-a': 'rel', text: 'label', 'text-page': 'label', raquo: 'label', arrow: 'label', arrows: 'label', aria: 'label', title: 'label', hidden: 'label', older: 'label', upper: 'label'};
  for (const [style, how] of Object.entries(spellings)) assert.deepEqual(await next(`next=${style}`), {url: second(`next=${style}`), how}, style);
  assert.deepEqual(await next('next=text&decoy=1'), {url: second('next=text&decoy=1'), how: 'label'}, 'the pager’s Next wins over a link named Next in the text');
  assert.deepEqual(await next('next=rel-link&p=2'), {url: `${fixture.base}/site/runs/page.html?next=rel-link&p=3`, how: 'rel'});
  pass('Next is found as <link rel="next">, <a rel="next">, and a link named next by its text, aria-label or title, in 12 spellings', {spellings: Object.keys(spellings)});
  for (const style of ['none', 'disabled', 'self', 'script', 'invisible', 'article', 'newer']) assert.equal(await next(`next=${style}`), null, style);
  assert.equal(await next('next=text&p=3'), null, 'the last page has no Next');
  assert.deepEqual(await next('next=button'), {button: true}, 'a button named Next has no address to go to');
  assert.deepEqual(await next('next=text&p=3&after=loop'), {url: `${fixture.base}/site/runs/page.html?next=text&p=1&after=loop`, how: 'label'}, 'a loop is the background’s to notice');
  assert.equal((await next('next=text&p=3&after=other')).url, `${fixture.other}/site/runs/page.html?next=text&p=1`, 'another site is the background’s to judge');
  pass('No Next: none, a link switched off, a link to this same page, a script address, a hidden link, and words that only look like it; a button is told apart');
  await page.close();

  /* The notice at 320 px, and its contrast in a light and a dark theme. */
  const narrow = await browser.newContext({viewport: {width: 320, height: 640}});
  const measured = [];
  for (const [theme, scheme] of [['meteor', 'light'], ['meteor', 'dark'], ['ember', 'light'], ['graphite', 'dark']]) {
    page = await open(narrow, listing());
    await page.evaluate((card) => window.__stub.deliver({type: 'content.configure', holdKey: 'z', holdTrigger: 'letter', enabled: false, card}), cardTheme(theme, scheme));
    await page.evaluate(() => window.__stub.deliver({type: 'content.run', runId: 'run-look', text: 'Following Next: page 14 of up to 20 · screen 49 of up to 50 · 4,812 links'}));
    const look = await page.evaluate(() => {
      const root = document.getElementById('link-meteor-run-notice').shadowRoot, panel = root.querySelector('.panel').getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
      const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
      // The Stop button's own fill is a faint tint of its text color over the panel; the panel is the ground.
      const ground = lum(rgb(getComputedStyle(root.querySelector('.panel')).backgroundColor));
      const ratio = (selector) => { const text = lum(rgb(getComputedStyle(root.querySelector(selector)).color)); return Math.round(((Math.max(text, ground) + .05) / (Math.min(text, ground) + .05)) * 100) / 100; };
      return {left: panel.left, right: panel.right, overflow: document.documentElement.scrollWidth > innerWidth, text: ratio('.run-text'), stop: ratio('.run-stop'), focusable: root.querySelector('.run-stop').tabIndex === 0};
    });
    assert.ok(look.left >= 0 && look.right <= 320 && !look.overflow, `${theme} ${scheme}: the notice fits at 320 px (${look.left} to ${look.right})`);
    assert.ok(look.text >= 4.5 && look.stop >= 4.5, `${theme} ${scheme}: contrast ${look.text} and ${look.stop}`);
    assert.equal(look.focusable, true, 'Stop can be reached by keyboard');
    measured.push({theme, scheme, text: look.text, stop: look.stop});
    const name = `run-notice-320-${theme}-${scheme}.png`;
    await page.screenshot({path: resolve(evidence, name)}); result.screenshots.push(name);
    await page.close();
  }
  result.contrast = measured;
  pass('At 320 px the notice fits, and its text and Stop have at least 4.5:1 contrast in light and dark themes', {lowest: Math.min(...measured.flatMap((entry) => [entry.text, entry.stop]))});
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'scroll-content-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.result, `${result.checks.length} checks`);
}
