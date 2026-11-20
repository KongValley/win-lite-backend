'use strict';

const { sendJson, sendNoContent } = require('../http/respond');
const { HttpError } = require('../lib/http-error');
const {
  normalizeCreateInput,
  normalizeUpdateInput,
  parseListQuery,
} = require('../lib/task-input');

function taskNotFound() {
  return new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
}

function createTaskHandlers(store) {
  return {
    list(ctx) {
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

    async create(ctx) {
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

    get(ctx) {
      const task = store.get(ctx.params.id);
      if (!task) {
        throw taskNotFound();
      }

      sendJson(ctx.req, ctx.res, 200, { data: task });
    },

    async update(ctx) {
      const patch = normalizeUpdateInput(ctx.body);
      const task = await store.update(ctx.params.id, patch);
      if (!task) {
        throw taskNotFound();
      }

      sendJson(ctx.req, ctx.res, 200, { data: task });
    },

    async remove(ctx) {
      const deleted = await store.delete(ctx.params.id);
      if (!deleted) {
        throw taskNotFound();
      }

      sendNoContent(ctx.req, ctx.res);
    },
  };
}

module.exports = { createTaskHandlers };
