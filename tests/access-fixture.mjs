// A second local fixture site for the access checks: the same synthetic pages as
// tests/helpers/browser.mjs, served on another port, so it is a different origin that no other
// suite grants. Default port: the fixture port + 10 (52478 + 10, or LINK_METEOR_FIXTURE_PORT + 10).
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

export async function secondFixture(port = Number(process.env.LINK_METEOR_SECOND_PORT || Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478) + 10)) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = ['/index.html', '/frame.html', '/empty.html'].includes(pathname) ? pathname : '/empty.html';
    try {
      const body = await readFile(resolve(root, 'tests/fixtures' + name));
      res.writeHead(200, {'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store'}); res.end(body);
    } catch { res.writeHead(500); res.end('Fixture unavailable'); }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {base, server, close: () => new Promise((done) => server.close(done))};
}
