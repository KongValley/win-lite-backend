'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const STORE_VERSION = 1;
const PRIORITIES = new Set(['low', 'medium', 'high']);
const MAX_STORE_BYTES = 32 * 1024 * 1024;

class StoreError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StoreError';
  }
}

function cloneTask(task) {
  return { ...task };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateStoredTask(task, index) {
  const label = `tasks[${index}]`;

  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new StoreError(`${label} must be an object`);
  }
  if (!isNonEmptyString(task.id)) {
    throw new StoreError(`${label}.id must be a non-empty string`);
  }
  if (!isNonEmptyString(task.title)) {
    throw new StoreError(`${label}.title must be a non-empty string`);
  }
  if (typeof task.description !== 'string') {
    throw new StoreError(`${label}.description must be a string`);
  }
  if (!PRIORITIES.has(task.priority)) {
    throw new StoreError(`${label}.priority must be low, medium or high`);
  }
  if (typeof task.completed !== 'boolean') {
    throw new StoreError(`${label}.completed must be a boolean`);
  }
  if (!isIsoTimestamp(task.createdAt) || !isIsoTimestamp(task.updatedAt)) {
    throw new StoreError(`${label} has invalid timestamps`);
  }
}

async function replaceFile(source, destination) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      // Antivirus/indexers on Windows can briefly lock the destination file.
      if (!retryable.has(error.code) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }

  throw lastError;
}

/**
 * File-backed task repository. Mutations are serialised and written to a
 * temporary file before an atomic rename, so a crash cannot leave a partially
 * written JSON document behind.
 */
class TaskStore {
  constructor(options) {
    this.filePath = path.resolve(options.filePath);
    this.logger = options.logger;
    this.tasks = [];
    this.writeChain = Promise.resolve();
    this.initPromise = null;
  }

  init() {
    if (this.initPromise === null) {
      this.initPromise = this.#initialize();
    }
    return this.initPromise;
  }

  async #initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let raw;
    try {
      const stats = await fs.stat(this.filePath);
      if (stats.size > MAX_STORE_BYTES) {
        throw new StoreError(
          `Data file is too large (${stats.size} bytes): ${this.filePath}`,
        );
      }
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error instanceof StoreError
          ? error
          : new StoreError(`Unable to read data file: ${this.filePath}`, {
              cause: error,
            });
      }

      this.tasks = [];
      await this.#writeSnapshot([]);
      return;
    }

    // Notepad and PowerShell may write UTF-8 with a BOM. Strip it so the data
    // file remains usable when edited manually on Windows.
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }

    let document;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new StoreError(`Data file contains invalid JSON: ${this.filePath}`, {
        cause: error,
      });
    }

    const tasks = Array.isArray(document) ? document : document && document.tasks;
    if (!Array.isArray(tasks)) {
      throw new StoreError(
        `Data file must contain a "tasks" array: ${this.filePath}`,
      );
    }
    if (
      !Array.isArray(document) &&
      document.version !== undefined &&
      document.version !== STORE_VERSION
    ) {
      throw new StoreError(
        `Unsupported data file version ${document.version}: ${this.filePath}`,
      );
    }

    const ids = new Set();
    tasks.forEach((task, index) => {
      validateStoredTask(task, index);
      if (ids.has(task.id)) {
        throw new StoreError(`Duplicate task id at tasks[${index}]: ${task.id}`);
      }
      ids.add(task.id);
    });

    this.tasks = tasks.map(cloneTask);
  }

  async #writeSnapshot(tasks) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto
        .randomBytes(6)
        .toString('hex')}.tmp`,
    );
    const document = `${JSON.stringify({ version: STORE_VERSION, tasks }, null, 2)}\n`;

    try {
      const handle = await fs.open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(document, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      await replaceFile(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw new StoreError(`Unable to write data file: ${this.filePath}`, {
        cause: error,
      });
    }
  }

  #enqueue(operation) {
    const result = this.writeChain.then(operation);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  list(options = {}) {
    const status = options.status || 'all';
    const priority = options.priority || 'all';
    const query = (options.q || '').toLowerCase();
    const limit = options.limit === undefined ? 20 : options.limit;
    const offset = options.offset === undefined ? 0 : options.offset;

    const filtered = this.tasks.filter((task) => {
      if (status === 'open' && task.completed) {
        return false;
      }
      if (status === 'completed' && !task.completed) {
        return false;
      }
      if (priority !== 'all' && task.priority !== priority) {
        return false;
      }
      if (query) {
        const haystack = `${task.title}\n${task.description}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });

    return {
      items: filtered.slice(offset, offset + limit).map(cloneTask),
      total: filtered.length,
    };
  }

  get(id) {
    const task = this.tasks.find((candidate) => candidate.id === id);
    return task ? cloneTask(task) : null;
  }

  create(input) {
    return this.#enqueue(async () => {
      const now = new Date().toISOString();
      const task = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description,
        priority: input.priority,
        completed: input.completed,
        createdAt: now,
        updatedAt: now,
      };
      const nextTasks = [task, ...this.tasks];

      await this.#writeSnapshot(nextTasks);
      this.tasks = nextTasks;
      return cloneTask(task);
    });
  }

  update(id, patch) {
    return this.#enqueue(async () => {
      const index = this.tasks.findIndex((candidate) => candidate.id === id);
      if (index === -1) {
        return null;
      }

      const current = this.tasks[index];
      const updated = {
        ...current,
        ...(Object.prototype.hasOwnProperty.call(patch, 'title')
          ? { title: patch.title }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'description')
          ? { description: patch.description }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'priority')
          ? { priority: patch.priority }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'completed')
          ? { completed: patch.completed }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      const nextTasks = this.tasks.slice();
      nextTasks[index] = updated;

      await this.#writeSnapshot(nextTasks);
      this.tasks = nextTasks;
      return cloneTask(updated);
    });
  }

  delete(id) {
    return this.#enqueue(async () => {
      const index = this.tasks.findIndex((candidate) => candidate.id === id);
      if (index === -1) {
        return false;
      }

      const nextTasks = this.tasks.slice();
      nextTasks.splice(index, 1);
      await this.#writeSnapshot(nextTasks);
      this.tasks = nextTasks;
      return true;
    });
  }

  async flush() {
    await this.writeChain;
  }
}

module.exports = {
  STORE_VERSION,
  StoreError,
  TaskStore,
};
