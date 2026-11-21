import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { CreateTaskInput } from '../src/domain';
import { STORE_VERSION, StoreError, TaskStore } from '../src/store/task-store';

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-store-'));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function taskInput(title: string): CreateTaskInput {
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
  const store = new TaskStore({ filePath });

  await store.init();

  const document = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  assert.deepEqual(document, { version: STORE_VERSION, tasks: [] });
  assert.deepEqual(store.list().items, []);
});

test('serialises concurrent creates and reloads them from disk', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');
  const store = new TaskStore({ filePath });
  await store.init();

  const created = await Promise.all([
    store.create(taskInput('one')),
    store.create(taskInput('two')),
    store.create(taskInput('three')),
  ]);
  await store.flush();

  assert.equal(new Set(created.map((task) => task.id)).size, 3);

  const reloaded = new TaskStore({ filePath });
  await reloaded.init();
  const result = reloaded.list({ limit: 10 });
  assert.equal(result.total, 3);
  assert.deepEqual(
    new Set(result.items.map((task) => task.title)),
    new Set(['one', 'two', 'three']),
  );

  const document = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
    version: unknown;
    tasks: unknown[];
  };
  assert.equal(document.version, STORE_VERSION);
  assert.equal(document.tasks.length, 3);
});

test('applies queued updates to the latest task state and persists deletes', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');
  const store = new TaskStore({ filePath });
  await store.init();

  const task = await store.create(taskInput('original'));
  const [renamed, completed] = await Promise.all([
    store.update(task.id, { title: 'renamed' }),
    store.update(task.id, { completed: true }),
  ]);

  assert.ok(renamed);
  assert.ok(completed);
  assert.equal(renamed.title, 'renamed');
  assert.equal(completed.title, 'renamed');
  assert.equal(completed.completed, true);

  const reloaded = new TaskStore({ filePath });
  await reloaded.init();
  const reloadedTask = reloaded.get(task.id);
  assert.ok(reloadedTask);
  assert.equal(reloadedTask.title, 'renamed');
  assert.equal(reloadedTask.completed, true);

  assert.equal(await reloaded.update('missing', { title: 'x' }), null);
  assert.equal(await reloaded.delete('missing'), false);
  assert.equal(await reloaded.delete(task.id), true);
  await reloaded.flush();

  const afterDelete = new TaskStore({ filePath });
  await afterDelete.init();
  assert.equal(afterDelete.list().total, 0);
});

test('filters and paginates tasks', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new TaskStore({
    filePath: path.join(directory, 'tasks.json'),
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
  assert.equal(completed.items[0]?.title, 'Alpha project');

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

  const store = new TaskStore({ filePath });
  await store.init();
  assert.equal(store.list().items[0]?.title, 'written by notepad');
});

test('refuses to overwrite corrupt or invalid data files', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'tasks.json');

  await fs.writeFile(filePath, '{"version":1,"tasks":[');
  const corrupt = new TaskStore({ filePath });
  await assert.rejects(corrupt.init(), (error: unknown) => {
    assert.ok(error instanceof StoreError);
    assert.match(error.message, /invalid JSON/);
    return true;
  });

  const invalidContent = JSON.stringify({
    version: 1,
    tasks: [{ id: 'only-an-id' }],
  });
  await fs.writeFile(filePath, invalidContent);
  const invalid = new TaskStore({ filePath });
  await assert.rejects(invalid.init(), (error: unknown) => {
    assert.ok(error instanceof StoreError);
    assert.match(error.message, /title/);
    return true;
  });

  assert.equal(await fs.readFile(filePath, 'utf8'), invalidContent);
});
