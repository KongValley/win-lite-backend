import type { RequestContext } from '../context';
import { sendJson, sendNoContent } from '../http/respond';
import { HttpError } from '../lib/http-error';
import {
  normalizeCreateInput,
  normalizeUpdateInput,
  parseListQuery,
} from '../lib/task-input';
import type { TaskStore } from '../store/task-store';

function taskNotFound(): HttpError {
  return new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
}

export interface TaskHandlers {
  list(ctx: RequestContext): void;
  create(ctx: RequestContext): Promise<void>;
  get(ctx: RequestContext): void;
  update(ctx: RequestContext): Promise<void>;
  remove(ctx: RequestContext): Promise<void>;
}

export function createTaskHandlers(store: TaskStore): TaskHandlers {
  return {
    list(ctx: RequestContext): void {
      const query = parseListQuery(ctx.url.searchParams);
      const result = store.list(query);

      sendJson(ctx.req, ctx.res, 200, {
        data: result.items,
        meta: {
          total: result.total,
          count: result.items.length,
          limit: query.limit,
          offset: query.offset,
          filters: {
            status: query.status,
            priority: query.priority,
            q: query.q,
          },
        },
      });
    },

    async create(ctx: RequestContext): Promise<void> {
      const input = normalizeCreateInput(ctx.body);
      const task = await store.create(input);

      sendJson(
        ctx.req,
        ctx.res,
        201,
        { data: task },
        { Location: `/api/tasks/${encodeURIComponent(task.id)}` },
      );
    },

    get(ctx: RequestContext): void {
      const task = store.get(ctx.params.id ?? '');
      if (!task) {
        throw taskNotFound();
      }

      sendJson(ctx.req, ctx.res, 200, { data: task });
    },

    async update(ctx: RequestContext): Promise<void> {
      const patch = normalizeUpdateInput(ctx.body);
      const task = await store.update(ctx.params.id ?? '', patch);
      if (!task) {
        throw taskNotFound();
      }

      sendJson(ctx.req, ctx.res, 200, { data: task });
    },

    async remove(ctx: RequestContext): Promise<void> {
      const deleted = await store.delete(ctx.params.id ?? '');
      if (!deleted) {
        throw taskNotFound();
      }

      sendNoContent(ctx.req, ctx.res);
    },
  };
}
