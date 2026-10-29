const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup({ serverBuild = 'new', storage = new Map(), update = async () => {} } = {}) {
  const events = [];
  let reloads = 0;
  let requests = 0;
  const source = fs.readFileSync('src/version.ts', 'utf8').replaceAll('import.meta.env.DEV', 'false');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = {
    exports: {}, __BUILD_ID__: 'old',
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: { serviceWorker: { getRegistration: async () => ({ update, installing: null, waiting: null }) } },
    window: { dispatchEvent: event => events.push(event.type), location: { reload: () => reloads++ }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async () => { requests++; return { ok: true, json: async () => ({ build: serverBuild }) }; },
  };
  vm.runInNewContext(code, context);
  return { api: context.exports, events, storage, reloads: () => reloads, requests: () => requests };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('confirms a mismatched header before announcing an update', async () => {
  const app = setup({ serverBuild: 'old' });
  app.api.observeApiBuild({ headers: { get: () => 'stale' } });
  await tick();
  assert.equal(app.requests(), 1);
  assert.deepEqual(app.events, []);
});

test('applies a confirmed update once and suppresses a reload loop', async () => {
  const app = setup();
  app.api.startVersionWatch();
  await tick();
  assert.deepEqual(app.events, ['kazari:update-ready']);
  await app.api.applyPendingVersionUpdate();
  assert.equal(app.reloads(), 1);
  const next = setup({ storage: app.storage });
  next.api.startVersionWatch();
  await tick();
  assert.deepEqual(next.events, []);
  const newer = setup({ storage: app.storage, serverBuild: 'newer' });
  newer.api.startVersionWatch();
  await tick();
  assert.deepEqual(newer.events, ['kazari:update-ready']);
});

test('does not reload when the service worker update fails', async () => {
  const app = setup({ update: async () => { throw new Error('offline'); } });
  app.api.startVersionWatch();
  await tick();
  await app.api.applyPendingVersionUpdate();
  assert.equal(app.reloads(), 0);
  assert.deepEqual(app.events, ['kazari:update-ready', 'kazari:update-cancelled']);
  assert.equal(app.api.hasPendingVersionUpdate(), false);
});
