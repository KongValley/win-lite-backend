'use strict';

const { sendJson } = require('../http/respond');
const { createHealthHandler } = require('./health');
const { createSystemHandler } = require('./system');
const { createTaskHandlers } = require('./tasks');

function createRootHandler(config) {
  return function root(ctx) {
    sendJson(ctx.req, ctx.res, 200, {
      service: config.serviceName,
      version: config.version,
      status: 'running',
      docs: '/api',
      health: '/api/health',
    });
  };
}

function createApiIndexHandler(config) {
  const auth = Boolean(config.apiKey);

  return function apiIndex(ctx) {
    sendJson(ctx.req, ctx.res, 200, {
      service: config.serviceName,
      version: config.version,
      authentication: auth ? 'API key required' : 'disabled',
      endpoints: {
        health: {
          method: 'GET',
          path: '/api/health',
          authentication: false,
        },
        system: {
          method: 'GET',
          path: '/api/system',
          authentication: auth,
        },
        listTasks: {
          method: 'GET',
          path: '/api/tasks?status=all|open|completed&priority=all|low|medium|high&q=text&limit=20&offset=0',
          authentication: auth,
        },
        createTask: {
          method: 'POST',
          path: '/api/tasks',
          authentication: auth,
        },
        getTask: {
          method: 'GET',
          path: '/api/tasks/:id',
          authentication: auth,
        },
        updateTask: {
          method: 'PATCH',
          path: '/api/tasks/:id',
          authentication: auth,
        },
        deleteTask: {
          method: 'DELETE',
          path: '/api/tasks/:id',
          authentication: auth,
        },
      },
    });
  };
}

function registerRoutes(router, options) {
  const { config, store } = options;
  const tasks = createTaskHandlers(store);

  router.get('/', createRootHandler(config), { public: true });
  router.get('/api', createApiIndexHandler(config), { public: true });
  router.get('/api/health', createHealthHandler(config), { public: true });
  router.get('/api/system', createSystemHandler(config));

  router.get('/api/tasks', tasks.list);
  router.post('/api/tasks', tasks.create);
  router.get('/api/tasks/:id', tasks.get);
  router.patch('/api/tasks/:id', tasks.update);
  router.delete('/api/tasks/:id', tasks.remove);
}

module.exports = {
  createApiIndexHandler,
  registerRoutes,
};
