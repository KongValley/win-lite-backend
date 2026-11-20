'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLogger } = require('../src/lib/logger');
const { StoreError, TaskStore } = require('../src/store/task-store');

const logger = createLogger({ level: 'silent' });

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-store-'));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function taskInput(title) {
  return {
    title,
    description: '',
    priority: 'medium',
    completed: false,
  };
}

test('creates an empty data file on first initialisation', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'nested', 'tasks.json');
  const store = new TaskStore({ filePath, logger });

  await store.init();

  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.deepEqual(document, { version: 1, tasks: [] });
  assert.deepEqual(store.list().items, []);
});

test('serialises concurrent creates and reloads them from disk', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');
  const store = new TaskStore({ filePath, logger });
  await store.init();

  const created = await Promise.all([
    store.create(taskInput('one')),
    store.create(taskInput('two')),
    store.create(taskInput('three')),
  ]);
  await store.flush();

  assert.equal(new Set(created.map((task) => task.id)).size, 3);

  const reloaded = new TaskStore({ filePath, logger });
  await reloaded.init();
  const result = reloaded.list({ limit: 10 });
  assert.equal(result.total, 3);
  assert.deepEqual(
    new Set(result.items.map((task) => task.title)),
    new Set(['one', 'two', 'three']),
  );

  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(document.version, 1);
  assert.equal(document.tasks.length, 3);
});

test('applies queued updates to the latest task state and persists deletes', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');
  const store = new TaskStore({ filePath, logger });
  await store.init();

  const task = await store.create(taskInput('original'));
  const [renamed, completed] = await Promise.all([
    store.update(task.id, { title: 'renamed' }),
    store.update(task.id, { completed: true }),
  ]);

  assert.equal(renamed.title, 'renamed');
  assert.equal(completed.title, 'renamed');
  assert.equal(completed.completed, true);

  const reloaded = new TaskStore({ filePath, logger });
  await reloaded.init();
  assert.equal(reloaded.get(task.id).title, 'renamed');
  assert.equal(reloaded.get(task.id).completed, true);

  assert.equal(await reloaded.update('missing', { title: 'x' }), null);
  assert.equal(await reloaded.delete('missing'), false);
  assert.equal(await reloaded.delete(task.id), true);
  await reloaded.flush();

  const afterDelete = new TaskStore({ filePath, logger });
  await afterDelete.init();
  assert.equal(afterDelete.list().total, 0);
});

test('filters and paginates tasks', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new TaskStore({
    filePath: path.join(directory, 'tasks.json'),
    logger,
  });
  await store.init();

  const low = await store.create({
    ...taskInput('Alpha project'),
    priority: 'low',
  });
  await store.create({ ...taskInput('Beta project'), priority: 'high' });
  await store.update(low.id, { completed: true });

  const completed = store.list({ status: 'completed' });
  assert.equal(completed.total, 1);
  assert.equal(completed.items[0].title, 'Alpha project');

  const highPriority = store.list({ priority: 'high' });
  assert.equal(highPriority.total, 1);

  const search = store.list({ q: 'project' });
  assert.equal(search.total, 2);

  const page = store.list({ limit: 1, offset: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
});

test('accepts a UTF-8 BOM in a manually edited data file', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');
  const task = {
    id: '2fa57047-7ef1-49b6-b04d-2e7495ca0155',
    title: 'written by notepad',
    description: '',
    priority: 'medium',
    completed: false,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  };

  await fs.writeFile(
    filePath,
    `\ufeff${JSON.stringify({ version: 1, tasks: [task] })}`,
    'utf8',
  );

  const store = new TaskStore({ filePath, logger });
  await store.init();
  assert.equal(store.list().items[0].title, 'written by notepad');
});

test('refuses to overwrite corrupt or invalid data files', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');

  await fs.writeFile(filePath, '{"version":1,"tasks":[');
  const corrupt = new TaskStore({ filePath, logger });
  await assert.rejects(corrupt.init(), (error) => {
    assert.ok(error instanceof StoreError);
    assert.match(error.message, /invalid JSON/);
    return true;
  });

  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 1, tasks: [{ id: 'only-an-id' }] }),
  );
  const invalid = new TaskStore({ filePath, logger });
  await assert.rejects(invalid.init(), (error) => {
    assert.ok(error instanceof StoreError);
    assert.match(error.message, /title/);
    return true;
  });

  assert.equal(await fs.readFile(filePath, 'utf8'), JSON.stringify({
    version: 1,
    tasks: [{ id: 'only-an-id' }],
  }));
});
