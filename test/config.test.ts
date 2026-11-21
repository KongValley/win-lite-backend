import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config';
import { loadEnvFile } from '../src/lib/env-file';

test('loads defaults and resolves the data file', () => {
  const root = path.join(os.tmpdir(), 'win-lite-config-defaults');
  const config = loadConfig({ env: {}, projectRoot: root });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3000);
  assert.equal(config.dataFile, path.join(root, 'data', 'tasks.json'));
  assert.deepEqual(config.corsOrigins, ['*']);
  assert.equal(config.rateLimitMax, 300);
  assert.equal(config.requestTimeoutMs, 30000);
});

test('reports invalid configuration values', () => {
  const root = path.join(os.tmpdir(), 'win-lite-config-invalid');

  assert.throws(
    () =>
      loadConfig({
        env: { PORT: 'abc', LOG_LEVEL: 'verbose', API_KEY: 'short' },
        projectRoot: root,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.messages.length, 3);
      assert.ok(error.messages.some((message) => message.startsWith('PORT')));
      assert.ok(error.messages.some((message) => message.startsWith('LOG_LEVEL')));
      assert.ok(error.messages.some((message) => message.startsWith('API_KEY')));
      return true;
    },
  );
});

test('normalises CORS origins and clamps header timeout', () => {
  const config = loadConfig({
    env: {
      CORS_ORIGIN: 'https://app.example/, https://admin.example',
      HEADERS_TIMEOUT_MS: '60000',
      REQUEST_TIMEOUT_MS: '5000',
    },
    projectRoot: os.tmpdir(),
  });

  assert.deepEqual(config.corsOrigins, [
    'https://app.example',
    'https://admin.example',
  ]);
  assert.equal(config.headersTimeoutMs, 5000);
});

test('parses a .env file without overriding existing variables', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-env-'));
  const filePath = path.join(directory, '.env');
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  await fs.writeFile(
    filePath,
    [
      '# comment',
      'PORT=3333',
      'export SECRET="line\\nnext"',
      "SPACED='  keep me  '",
      'WINDOWS_PATH="C:\\data\\tasks.json"',
      'HASHED="keep # this" # outside comment',
      'INLINE=value # trailing comment',
      'EXISTING=from-file',
      '',
    ].join('\r\n'),
  );

  const env: NodeJS.ProcessEnv = { EXISTING: 'from-environment' };
  const loaded = loadEnvFile(filePath, { env });

  assert.equal(env.PORT, '3333');
  assert.equal(env.SECRET, 'line\\nnext');
  assert.equal(env.SPACED, '  keep me  ');
  assert.equal(env.WINDOWS_PATH, 'C:\\data\\tasks.json');
  assert.equal(env.HASHED, 'keep # this');
  assert.equal(env.INLINE, 'value');
  assert.equal(env.EXISTING, 'from-environment');
  assert.deepEqual(loaded.sort(), [
    'HASHED',
    'INLINE',
    'PORT',
    'SECRET',
    'SPACED',
    'WINDOWS_PATH',
  ]);
});

test('rejects malformed .env files', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-env-'));
  const filePath = path.join(directory, '.env');
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  await fs.writeFile(filePath, 'NO_EQUALS_SIGN\n');
  assert.throws(() => loadEnvFile(filePath, { env: {} }), /Invalid \.env entry/);

  await fs.writeFile(filePath, 'QUOTED="unclosed\n');
  assert.throws(() => loadEnvFile(filePath, { env: {} }), /Unclosed quoted value/);
});
