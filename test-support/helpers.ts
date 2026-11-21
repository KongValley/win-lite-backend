import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { loadConfig, type AppConfig } from '../src/config';
import { createLogger } from '../src/lib/logger';
import { createRuntime, type Runtime } from '../src/server';

export interface TestServer {
  readonly directory: string;
  readonly config: AppConfig;
  readonly runtime: Runtime;
  readonly baseUrl: string;
}

export interface JsonRequestOptions {
  readonly method?: string;
  readonly json?: unknown;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export interface JsonResponse<T = any> {
  readonly response: FetchResponse;
  readonly body: T;
  readonly text: string;
}

export async function createTestServer(
  t: TestContext,
  overrides: Record<string, string> = {},
): Promise<TestServer> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'win-lite-backend-'));
  const env: NodeJS.ProcessEnv = {
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

export async function requestJson<T = any>(
  baseUrl: string,
  pathname: string,
  options: JsonRequestOptions = {},
): Promise<JsonResponse<T>> {
  const { json, headers = {}, body, method } = options;
  const hasJson = json !== undefined;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: method ?? 'GET',
    headers: {
      ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: hasJson ? JSON.stringify(json) : body,
  });

  const text = await response.text();
  let parsed: T | undefined;
  if (text) {
    parsed = JSON.parse(text) as T;
  }

  return { response, body: parsed as T, text };
}
