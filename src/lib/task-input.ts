import {
  TASK_PRIORITIES,
  isTaskPriority,
  type CreateTaskInput,
  type TaskListQuery,
  type TaskPriority,
  type UpdateTaskInput,
} from '../domain';
import { badRequest } from './http-error';

const TASK_FIELDS = new Set(['title', 'description', 'priority', 'completed']);
const HAS_OWN = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

interface ValidationDetail {
  readonly field: string;
  readonly message: string;
}

export { TASK_PRIORITIES as PRIORITIES };

function unknownFieldErrors(body: Record<string, unknown>): ValidationDetail[] {
  const unknown = Object.keys(body).filter((key) => !TASK_FIELDS.has(key));
  if (unknown.length === 0) {
    return [];
  }

  const shown = unknown.slice(0, 10);
  const suffix = unknown.length > shown.length ? ', ...' : '';
  return [
    {
      field: 'body',
      message: `contains unsupported field(s): ${shown.join(', ')}${suffix}`.slice(
        0,
        500,
      ),
    },
  ];
}

function parseTitle(
  value: unknown,
  errors: ValidationDetail[],
  required: boolean,
): string | undefined {
  if (value === undefined) {
    if (required) {
      errors.push({ field: 'title', message: 'is required' });
    }
    return undefined;
  }

  if (typeof value !== 'string') {
    errors.push({ field: 'title', message: 'must be a string' });
    return undefined;
  }

  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) {
    errors.push({ field: 'title', message: 'must not be empty' });
    return undefined;
  }
  if (title.length > 200) {
    errors.push({ field: 'title', message: 'must not exceed 200 characters' });
    return undefined;
  }
  return title;
}

function parseDescription(
  value: unknown,
  errors: ValidationDetail[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    errors.push({ field: 'description', message: 'must be a string or null' });
    return undefined;
  }

  const description = value.trim();
  if (description.length > 5000) {
    errors.push({
      field: 'description',
      message: 'must not exceed 5000 characters',
    });
    return undefined;
  }
  return description;
}

function parsePriority(
  value: unknown,
  errors: ValidationDetail[],
): TaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isTaskPriority(value)) {
    errors.push({
      field: 'priority',
      message: `must be one of: ${TASK_PRIORITIES.join(', ')}`,
    });
    return undefined;
  }
  return value;
}

function parseCompleted(
  value: unknown,
  errors: ValidationDetail[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    errors.push({ field: 'completed', message: 'must be a boolean' });
    return undefined;
  }
  return value;
}

function throwIfInvalid(errors: ValidationDetail[]): void {
  if (errors.length > 0) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Request validation failed',
      errors.slice(0, 20),
    );
  }
}

export function normalizeCreateInput(
  body: Record<string, unknown>,
): CreateTaskInput {
  const errors = unknownFieldErrors(body);
  const title = parseTitle(body.title, errors, true);
  const description = parseDescription(body.description, errors) ?? '';
  const priority = parsePriority(body.priority, errors) ?? 'medium';
  const completed = parseCompleted(body.completed, errors) ?? false;
  throwIfInvalid(errors);

  return {
    title: title as string,
    description,
    priority,
    completed,
  };
}

export function normalizeUpdateInput(
  body: Record<string, unknown>,
): UpdateTaskInput {
  const errors = unknownFieldErrors(body);
  const patch: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    completed?: boolean;
  } = {};
  let hasField = false;

  if (HAS_OWN(body, 'title')) {
    hasField = true;
    const title = parseTitle(body.title, errors, false);
    if (title !== undefined) {
      patch.title = title;
    }
  }
  if (HAS_OWN(body, 'description')) {
    hasField = true;
    const description = parseDescription(body.description, errors);
    if (description !== undefined) {
      patch.description = description;
    }
  }
  if (HAS_OWN(body, 'priority')) {
    hasField = true;
    const priority = parsePriority(body.priority, errors);
    if (priority !== undefined) {
      patch.priority = priority;
    }
  }
  if (HAS_OWN(body, 'completed')) {
    hasField = true;
    const completed = parseCompleted(body.completed, errors);
    if (completed !== undefined) {
      patch.completed = completed;
    }
  }

  if (!hasField) {
    errors.push({
      field: 'body',
      message: 'must contain at least one of: title, description, priority, completed',
    });
  }

  throwIfInvalid(errors);
  return patch;
}

function parseNonNegativeInteger(
  errors: ValidationDetail[],
  value: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    errors.push({ field, message: 'must be a non-negative integer' });
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.push({ field, message: `must be between ${min} and ${max}` });
    return fallback;
  }
  return parsed;
}

export function parseListQuery(searchParams: URLSearchParams): TaskListQuery {
  const errors: ValidationDetail[] = [];
  const status = (searchParams.get('status') ?? 'all').toLowerCase();
  const priority = (searchParams.get('priority') ?? 'all').toLowerCase();
  const q = (searchParams.get('q') ?? '').trim();

  if (!['all', 'open', 'completed'].includes(status)) {
    errors.push({
      field: 'status',
      message: 'must be one of: all, open, completed',
    });
  }
  if (!['all', ...TASK_PRIORITIES].includes(priority)) {
    errors.push({
      field: 'priority',
      message: `must be one of: all, ${TASK_PRIORITIES.join(', ')}`,
    });
  }
  if (q.length > 100) {
    errors.push({ field: 'q', message: 'must not exceed 100 characters' });
  }

  const limit = parseNonNegativeInteger(
    errors,
    searchParams.get('limit'),
    'limit',
    20,
    1,
    100,
  );
  const offset = parseNonNegativeInteger(
    errors,
    searchParams.get('offset'),
    'offset',
    0,
    0,
    1000000,
  );

  if (errors.length > 0) {
    throw badRequest(
      'INVALID_QUERY',
      'Invalid query parameters',
      errors.slice(0, 20),
    );
  }

  return {
    status: status as TaskListQuery['status'],
    priority: priority as TaskListQuery['priority'],
    q,
    limit,
    offset,
  };
}
