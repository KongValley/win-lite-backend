'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/lib/logger');
const { createRuntime } = require('../src/server');

async function createTestServer(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-backend-'));
  const env = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DATA_FILE: 'tasks.json',
    CORS_ORIGIN: '*',
    RATE_LIMIT_MAX: '0',
    LOG_LEVEL: 'silent',
    ...overrides,
  };

  const config = loadConfig({ env, projectRoot: directory });
  const logger = createLogger({ level: 'silent' });
  const runtime = await createRuntime({ config, logger });
  const address = await runtime.listen(0, '127.0.0.1');

  t.after(async () => {
    await runtime.stop();
    await fs.rm(directory, { recursive: true, force: true });
  });

  return {
    directory,
    config,
    runtime,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const { json, headers = {}, body, ...rest } = options;
  const hasJson = json !== undefined;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...rest,
    headers: {
      ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: hasJson ? JSON.stringify(json) : body,
  });

  const text = await response.text();
  let parsed;
  if (text) {
    parsed = JSON.parse(text);
  }

  return { response, body: parsed, text };
}

module.exports = {
  createTestServer,
  requestJson,
};
