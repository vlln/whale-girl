import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

// Exercise DSH 0.1.7's public API contract without starting a model job.
test('DSH jobs, live config and plugin lifecycle', async () => {
  // All persistence goes to a disposable directory, never the user's pet state.
  const tempRoot = realpathSync(tmpdir());
  const home = mkdtempSync(join(tempRoot, 'whale-girl-compat-test-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const { apply, Config } = await import('../lib/index.mjs');
  let cleanups = [];
  function mount(config = {}) {
    const routes = new Map(), listeners = new Map(), services = new Map();
    let subscriber, disposed = false;
    let jobs = [{ id: 'bash-1', status: 'running', label: 'fixture', owner: 'session-1' }];
    const ctx = {
      agents: { list: () => [{ id: 'session-1' }] },
      jobs: {
        list(id) { assert.ok(id === undefined || id === 'session-1'); return jobs.filter(j => j.owner === undefined || j.owner === id); },
        events: { subscribe(filter, listener) { assert.deepEqual(filter, { owners: 'scope' }); subscriber = listener; return () => { disposed = true; }; } },
      },
      get(name) {
        if (name === 'webServer') return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } };
        if (name === 'sessions') return { list: () => [{ id: 'session-1', header: { createdAt: 1 }, events: [] }] };
      },
      effect(fn) { const dispose = fn(); cleanups.push(dispose); return dispose; },
      provide(name, value) { services.set(name, value); return () => services.delete(name); },
      on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    };
    apply(ctx, config);
    return {
      snapshot: () => services.get('whale-girl.pet').snapshot(),
      event: event => subscriber(event),
      sessionEvent: event => listeners.get('session/event')({ id: 'session-1' }, event),
      clearJobs: () => { jobs = []; },
      disposed: () => disposed,
      routes,
    };
  }
  try {
    assert.throws(() => Config({ size: 1 }));
    let currentConfig = Config({ size: 120 }).get();
    const configured = mount({ get: () => currentConfig });
    const configRoute = configured.routes.get('/whale-girl/config');
    assert.ok(configRoute);
    const readConfig = async () => {
      let body;
      await configRoute.handler({ method: 'GET' }, { writeHead(status) { assert.equal(status, 200); }, end(value) { body = JSON.parse(value); } });
      return body;
    };
    const firstConfig = await readConfig();
    assert.equal(firstConfig.config.size, 120);
    currentConfig = Config({ size: 100 }).get();
    const secondConfig = await readConfig();
    assert.equal(secondConfig.config.size, 100);
    assert.ok(secondConfig.revision > firstConfig.revision);
    for (const dispose of cleanups.splice(0)) dispose();
    const pet = mount();
    assert.ok(pet.routes.has('/whale-girl/state'));
    assert.equal(pet.snapshot().activity.name, 'working');
    pet.event({ type: 'progress', job: { id: 'bash-1', status: 'running' } });
    assert.equal(pet.snapshot().pet.stats.tasksDone, 0);
    pet.event({ type: 'settled', job: { id: 'bash-1', status: 'completed', label: 'fixture' } });
    pet.clearJobs();
    assert.equal(pet.snapshot().pet.stats.tasksDone, 1);
    const xp = pet.snapshot().pet.xp;
    pet.snapshot(); pet.snapshot();
    assert.equal(pet.snapshot().pet.xp, xp, 'Polling must not award XP again');
    pet.event({ type: 'settled', job: { id: 'bash-2', status: 'failed' } });
    assert.equal(pet.snapshot().pet.stats.failures, 1);
    pet.event({ type: 'settled', job: { id: 'bash-3', status: 'killed' } });
    assert.equal(pet.snapshot().pet.xp, xp);
    assert.equal(pet.snapshot().pet.stats.failures, 1);
    pet.sessionEvent({ type: 'turn/start', data: {} });
    assert.equal(pet.snapshot().activity.sessionThink, true);
    pet.sessionEvent({ type: 'turn/end', data: { reason: { kind: 'blocked' } } });
    assert.equal(pet.snapshot().activity.sessionThink, false);
    assert.equal(pet.snapshot().activity.sessionWait, true);
    for (const dispose of cleanups.splice(0)) dispose();
    assert.equal(pet.disposed(), true);
    const reloaded = mount();
    assert.equal(reloaded.snapshot().pet.xp, xp);
    assert.equal(reloaded.snapshot().pet.stats.tasksDone, 1);
    assert.equal(reloaded.snapshot().pet.stats.failures, 1);
    console.log('PASS: live config, validation, subscription, session IDs, completion, failure, cancellation, polling, turn state, disposal, persistence');
  } finally {
    for (const dispose of cleanups) dispose();
    if (!resolve(home).startsWith(tempRoot + sep)) throw new Error('Unsafe temporary cleanup path');
    rmSync(home, { recursive: true });
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});
