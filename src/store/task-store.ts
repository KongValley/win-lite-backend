import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  isTaskPriority,
  type CreateTaskInput,
  type Task,
  type TaskListOptions,
  type TaskListResult,
  type UpdateTaskInput,
} from '../domain';
import { getErrorCode } from '../lib/errors';

export const STORE_VERSION = 1;
const MAX_STORE_BYTES = 32 * 1024 * 1024;

export class StoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StoreError';
  }
}

export interface TaskStoreOptions {
  readonly filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneTask(task: Task): Task {
  return { ...task };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateStoredTask(task: unknown, index: number): asserts task is Task {
  const label = `tasks[${index}]`;

  if (!isRecord(task)) {
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
  if (!isTaskPriority(task.priority)) {
    throw new StoreError(`${label}.priority must be low, medium or high`);
  }
  if (typeof task.completed !== 'boolean') {
    throw new StoreError(`${label}.completed must be a boolean`);
  }
  if (!isIsoTimestamp(task.createdAt) || !isIsoTimestamp(task.updatedAt)) {
    throw new StoreError(`${label} has invalid timestamps`);
  }
}

async function replaceFile(source: string, destination: string): Promise<void> {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      const code = getErrorCode(error);
      // Antivirus/indexers on Windows can briefly lock the destination file.
      if (!code || !retryable.has(code) || attempt === 2) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }

  throw lastError;
}

/**
 * File-backed task repository. Mutations are serialised and written to a
 * temporary file before an atomic rename, so a crash cannot leave a partially
 * written JSON document behind.
 */
export class TaskStore {
  readonly filePath: string;
  private tasks: Task[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;

  constructor(options: TaskStoreOptions) {
    this.filePath = path.resolve(options.filePath);
  }

  init(): Promise<void> {
    if (this.initPromise === null) {
      this.initPromise = this.#initialize();
    }
    return this.initPromise;
  }

  async #initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let raw = '';
    try {
      const stats = await fs.stat(this.filePath);
      if (stats.size > MAX_STORE_BYTES) {
        throw new StoreError(
          `Data file is too large (${stats.size} bytes): ${this.filePath}`,
        );
      }
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      const code = getErrorCode(error);
      if (code !== 'ENOENT') {
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

    let document: unknown;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new StoreError(`Data file contains invalid JSON: ${this.filePath}`, {
        cause: error,
      });
    }

    let rawTasks: unknown[];
    let version: unknown;
    if (Array.isArray(document)) {
      rawTasks = document;
    } else if (isRecord(document) && Array.isArray(document.tasks)) {
      rawTasks = document.tasks;
      version = document.version;
    } else {
      throw new StoreError(
        `Data file must contain a "tasks" array: ${this.filePath}`,
      );
    }

    if (!Array.isArray(document) && version !== undefined && version !== STORE_VERSION) {
      throw new StoreError(
        `Unsupported data file version ${String(version)}: ${this.filePath}`,
      );
    }

    const ids = new Set<string>();
    const validated: Task[] = [];
    rawTasks.forEach((task, index) => {
      validateStoredTask(task, index);
      if (ids.has(task.id)) {
        throw new StoreError(`Duplicate task id at tasks[${index}]: ${task.id}`);
      }
      ids.add(task.id);
      validated.push(task);
    });

    this.tasks = validated.map(cloneTask);
  }

  async #writeSnapshot(tasks: readonly Task[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
    );
    const serialized = JSON.stringify({ version: STORE_VERSION, tasks }, null, 2);
    if (serialized === undefined) {
      throw new StoreError('Unable to serialize task data');
    }
    const document = `${serialized}\n`;

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

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  list(options: TaskListOptions = {}): TaskListResult {
    const status = options.status ?? 'all';
    const priority = options.priority ?? 'all';
    const query = (options.q ?? '').toLowerCase();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

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

  get(id: string): Task | null {
    const task = this.tasks.find((candidate) => candidate.id === id);
    return task ? cloneTask(task) : null;
  }

  create(input: CreateTaskInput): Promise<Task> {
    return this.#enqueue(async () => {
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
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

  update(id: string, patch: UpdateTaskInput): Promise<Task | null> {
    return this.#enqueue(async () => {
      const index = this.tasks.findIndex((candidate) => candidate.id === id);
      if (index === -1) {
        return null;
      }

      const current = this.tasks[index];
      if (!current) {
        return null;
      }

      const updated: Task = {
        ...current,
        ...(Object.prototype.hasOwnProperty.call(patch, 'title') &&
        patch.title !== undefined
          ? { title: patch.title }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'description') &&
        patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'priority') &&
        patch.priority !== undefined
          ? { priority: patch.priority }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'completed') &&
        patch.completed !== undefined
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

  delete(id: string): Promise<boolean> {
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

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
