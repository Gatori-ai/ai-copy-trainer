// The local page. Listens on 127.0.0.1 only.
import http from 'node:http';
import path from 'node:path';
import * as store from './store.mjs';
import * as engine from './engine.mjs';
import { notify } from './notify.mjs';

const { p, read, REPO } = store;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(Object.assign(new Error('Request too large.'), { code: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Body is not valid JSON.'), { code: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// One model job at a time keeps two clicks from writing the rules file at once.
let chain = Promise.resolve();
let busy = null;
function queued(label, fn) {
  const run = chain.then(async () => {
    busy = label;
    try {
      return await fn();
    } finally {
      busy = null;
    }
  });
  chain = run.catch(() => {});
  return run;
}

export function createServer({ complete } = {}) {
  const opts = complete ? { complete } : {};
  const routes = {
    'GET /api/state': async () => ({
      status: engine.status(),
      busy,
      drafts: store.listDrafts().slice(0, 60),
      voice: read(p.voice()),
      context: read(p.context()),
      log: read(p.log()),
      topics: read(p.topics()),
    }),
    'POST /api/setup': async (b) => {
      const config = store.loadConfig();
      store.init({ name: b.name });
      if (typeof b.name === 'string' && b.name.trim()) config.name = b.name.trim().slice(0, 80);
      if (Array.isArray(b.formats) && b.formats.length) {
        const known = store.formats(config).map((f) => f.id);
        const picked = b.formats.filter((f) => known.includes(f));
        if (picked.length) config.formats = picked;
      }
      store.saveConfig(config);
      if (typeof b.context === 'string' && b.context.trim()) store.write(p.context(), b.context.trim() + '\n');
      if (typeof b.samples === 'string') {
        store.addSamples(b.samples.split(/\n\s*-{3,}\s*\n/));
      }
      return queued('Reading your samples and writing the rules', () => engine.foundation(opts));
    },
    'POST /api/draft': async (b) =>
      queued('Writing a draft', () => engine.draft({ format: b.format, topic: b.topic, source: 'button', ...opts })),
    'POST /api/feedback': async (b) =>
      queued(b.action === 'rewrite' ? 'Learning from your feedback and rewriting' : 'Learning from your feedback', () =>
        engine.feedback({ id: b.id, action: b.action, final: b.final, note: b.note, ...opts }),
      ),
    'POST /api/topics': async (b) => {
      if (typeof b.topics !== 'string') throw Object.assign(new Error('topics must be text.'), { code: 400 });
      store.write(p.topics(), b.topics);
      return { ok: true };
    },
    'POST /api/voice': async (b) => {
      if (typeof b.voice !== 'string' || !b.voice.trim()) throw Object.assign(new Error('voice must be text.'), { code: 400 });
      store.write(p.voice(), b.voice.trimEnd() + '\n');
      store.logChanges({ draftId: 'manual edit', lessons: ['VOICE.md edited by hand on the page.'], results: [] });
      return { ok: true };
    },
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // A page on another site must not be able to drive this server.
      const host = (req.headers.host || '').split(':')[0];
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'Local use only.' });
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
          return send(res, 403, { error: 'Cross-site request refused.' });
        }
        if (!(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 415, { error: 'Send JSON.' });
        }
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, read(path.join(REPO, 'web', 'index.html')), 'text/html; charset=utf-8');
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'Not found.' });
      const input = req.method === 'POST' ? await body(req) : {};
      store.init();
      return send(res, 200, await handler(input));
    } catch (e) {
      return send(res, e.code && Number.isInteger(e.code) ? e.code : 400, { error: e.message });
    }
  });
}

// While the page is running it also makes the daily draft, once the set time passes.
export function startDailyTick({ port }) {
  const tick = async () => {
    try {
      const config = store.loadConfig();
      if (!config.daily.enabled || !store.hasFoundation()) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (hhmm < config.daily.time) return;
      const result = await queued('Writing today\'s draft', () => engine.daily());
      if (result.made) {
        await notify({
          title: 'New draft in your voice',
          body: `${result.item.topic} (${result.item.format})`,
          url: `http://localhost:${port}/`,
        });
      }
    } catch (e) {
      console.error(`daily draft failed: ${e.message}`);
    }
  };
  const timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 5000).unref();
  return timer;
}

export function serve({ port } = {}) {
  const config = store.loadConfig();
  const usePort = Number(port || process.env.PORT || config.port);
  store.init();
  const server = createServer();
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.timeout = 0;
  server.listen(usePort, '127.0.0.1', () => {
    console.log(`Daily Voice Training is at http://localhost:${usePort}/`);
    console.log(`Voice folder: ${store.home()}`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${usePort} is taken. Run: voice serve --port <other>` : e.message);
    process.exit(1);
  });
  startDailyTick({ port: usePort });
  return server;
}
