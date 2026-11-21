import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createTestServer, requestJson } from '../test-support/helpers';

describe('service metadata', () => {
  test('serves root, health and system information', async (t) => {
    const { baseUrl } = await createTestServer(t);

    const root = await requestJson(baseUrl, '/');
    assert.equal(root.response.status, 200);
    assert.equal(root.body.service, 'win-lite-backend');
    assert.equal(root.body.docs, '/api');
    assert.match(
      root.response.headers.get('x-request-id') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.equal(root.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(root.response.headers.get('cache-control'), 'no-store');

    const health = await requestJson(baseUrl, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.runtime.node, process.version);
    assert.equal(health.body.runtime.platform, process.platform);
    assert.equal(health.body.runtime.arch, process.arch);

    const system = await requestJson(baseUrl, '/api/system');
    assert.equal(system.response.status, 200);
    assert.equal(system.body.data.runtime.arch, process.arch);
    assert.equal(system.body.data.runtime.is32Bit, process.arch === 'ia32');
    assert.ok(system.body.data.os.totalMemoryBytes > 0);
  });

  test('supports HEAD requests without a response body', async (t) => {
    const { baseUrl } = await createTestServer(t);

    const health = await fetch(`${baseUrl}/api/health`, { method: 'HEAD' });
    assert.equal(health.status, 200);
    assert.equal(await health.text(), '');
    assert.ok(Number(health.headers.get('content-length')) > 0);

    const missing = await fetch(`${baseUrl}/api/not-here`, { method: 'HEAD' });
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '');
  });
});

describe('task API', () => {
  test('supports the complete CRUD lifecycle', async (t) => {
    const { baseUrl } = await createTestServer(t);

    const created = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      json: {
        title: '  first   task  ',
        description: '  hello  ',
        priority: 'high',
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.title, 'first task');
    assert.equal(created.body.data.description, 'hello');
    assert.equal(created.body.data.priority, 'high');
    assert.equal(created.body.data.completed, false);
    assert.match(created.body.data.id, /^[0-9a-f-]{36}$/);
    assert.equal(
      created.response.headers.get('location'),
      `/api/tasks/${created.body.data.id}`,
    );

    const id = created.body.data.id;
    const fetched = await requestJson(baseUrl, `/api/tasks/${id}`);
    assert.equal(fetched.response.status, 200);
    assert.deepEqual(fetched.body.data, created.body.data);

    const updated = await requestJson(baseUrl, `/api/tasks/${id}`, {
      method: 'PATCH',
      json: { title: 'renamed', completed: true, description: null },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.title, 'renamed');
    assert.equal(updated.body.data.completed, true);
    assert.equal(updated.body.data.description, '');

    const filtered = await requestJson(
      baseUrl,
      '/api/tasks?status=completed&priority=high&q=rename',
    );
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.meta.total, 1);
    assert.equal(filtered.body.data[0].id, id);

    const open = await requestJson(baseUrl, '/api/tasks?status=open');
    assert.equal(open.body.meta.total, 0);

    const deleted = await fetch(`${baseUrl}/api/tasks/${id}`, {
      method: 'DELETE',
    });
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');

    const gone = await requestJson(baseUrl, `/api/tasks/${id}`);
    assert.equal(gone.response.status, 404);
    assert.equal(gone.body.error.code, 'TASK_NOT_FOUND');
  });

  test('validates JSON bodies and query parameters', async (t) => {
    const { baseUrl } = await createTestServer(t);

    const missingTitle = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      json: { description: 'no title' },
    });
    assert.equal(missingTitle.response.status, 400);
    assert.equal(missingTitle.body.error.code, 'VALIDATION_ERROR');
    assert.equal(missingTitle.body.error.details[0].field, 'title');

    const unknown = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      json: { title: 'x', admin: true },
    });
    assert.equal(unknown.response.status, 400);
    assert.match(unknown.body.error.details[0].message, /unsupported field/);

    const emptyPatch = await requestJson(baseUrl, '/api/tasks/missing', {
      method: 'PATCH',
      json: {},
    });
    assert.equal(emptyPatch.response.status, 400);
    assert.equal(emptyPatch.body.error.code, 'VALIDATION_ERROR');

    const longTitle = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      json: { title: 'a'.repeat(201) },
    });
    assert.equal(longTitle.response.status, 400);

    const invalidQuery = await requestJson(baseUrl, '/api/tasks?limit=0');
    assert.equal(invalidQuery.response.status, 400);
    assert.equal(invalidQuery.body.error.code, 'INVALID_QUERY');

    const badJson = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":',
    });
    assert.equal(badJson.response.status, 400);
    assert.equal(badJson.body.error.code, 'INVALID_JSON');

    const arrayBody = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    assert.equal(arrayBody.response.status, 400);
    assert.equal(arrayBody.body.error.code, 'INVALID_BODY');

    const wrongMediaType = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"title":"x"}',
    });
    assert.equal(wrongMediaType.response.status, 415);
    assert.equal(wrongMediaType.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');

    const compressed = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: '{"title":"x"}',
    });
    assert.equal(compressed.response.status, 415);
  });

  test('enforces the request body limit and URL length', async (t) => {
    const { baseUrl } = await createTestServer(t, { MAX_BODY_BYTES: '1024' });

    const tooLarge = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      json: { title: 'x', description: 'a'.repeat(2000) },
    });
    assert.equal(tooLarge.response.status, 413);
    assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');

    const longUrl = await fetch(`${baseUrl}/api/tasks?q=${'a'.repeat(5000)}`);
    assert.equal(longUrl.status, 414);
    const longUrlBody = (await longUrl.json()) as {
      error: { code: string };
    };
    assert.equal(longUrlBody.error.code, 'URI_TOO_LONG');
  });

  test('returns 404 and 405 with useful headers', async (t) => {
    const { baseUrl } = await createTestServer(t, { CORS_ORIGIN: 'none' });

    const missing = await requestJson(baseUrl, '/api/missing');
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, 'ROUTE_NOT_FOUND');

    const notAllowed = await fetch(`${baseUrl}/api/tasks`, { method: 'PUT' });
    assert.equal(notAllowed.status, 405);
    assert.equal(notAllowed.headers.get('allow'), 'GET, HEAD, POST');

    const corsDisabledOptions = await fetch(`${baseUrl}/api/tasks`, {
      method: 'OPTIONS',
    });
    assert.equal(corsDisabledOptions.status, 405);
  });
});

describe('CORS', () => {
  test('answers preflight requests and exposes allowed origins', async (t) => {
    const { baseUrl } = await createTestServer(t);

    const preflight = await fetch(`${baseUrl}/api/tasks`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.equal(preflight.headers.get('access-control-max-age'), '600');

    const actual = await requestJson(baseUrl, '/api/health', {
      headers: { Origin: 'https://app.example' },
    });
    assert.equal(actual.response.status, 200);
    assert.equal(
      actual.response.headers.get('access-control-allow-origin'),
      '*',
    );
  });

  test('supports an explicit origin allowlist', async (t) => {
    const { baseUrl } = await createTestServer(t, {
      CORS_ORIGIN: 'https://app.example, https://admin.example/',
    });

    const allowed = await requestJson(baseUrl, '/api/health', {
      headers: { Origin: 'https://admin.example' },
    });
    assert.equal(
      allowed.response.headers.get('access-control-allow-origin'),
      'https://admin.example',
    );

    const denied = await requestJson(baseUrl, '/api/health', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(denied.response.headers.get('access-control-allow-origin'), null);
    assert.equal(denied.response.headers.get('vary'), 'Origin');
  });
});

describe('authentication', () => {
  const apiKey = 'test-api-key-0123456789abcdef';

  test('protects private endpoints when API_KEY is set', async (t) => {
    const { baseUrl } = await createTestServer(t, { API_KEY: apiKey });

    const health = await requestJson(baseUrl, '/api/health');
    assert.equal(health.response.status, 200);

    const apiIndex = await requestJson(baseUrl, '/api');
    assert.equal(apiIndex.response.status, 200);
    assert.equal(apiIndex.body.authentication, 'API key required');

    const unauthorized = await requestJson(baseUrl, '/api/tasks');
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.body.error.code, 'UNAUTHORIZED');
    assert.match(
      unauthorized.response.headers.get('www-authenticate') ?? '',
      /^Bearer/,
    );

    const wrongKey = await requestJson(baseUrl, '/api/tasks', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    assert.equal(wrongKey.response.status, 401);

    const authorized = await requestJson(baseUrl, '/api/tasks', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(authorized.response.status, 200);

    const created = await requestJson(baseUrl, '/api/tasks', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      json: { title: 'authenticated task' },
    });
    assert.equal(created.response.status, 201);

    const systemWithoutKey = await requestJson(baseUrl, '/api/system');
    assert.equal(systemWithoutKey.response.status, 401);

    const systemWithKey = await requestJson(baseUrl, '/api/system', {
      headers: { 'X-API-Key': apiKey },
    });
    assert.equal(systemWithKey.response.status, 200);
  });
});

describe('rate limiting', () => {
  test('limits requests per client and skips non-API routes', async (t) => {
    const { baseUrl } = await createTestServer(t, { RATE_LIMIT_MAX: '2' });

    const first = await requestJson(baseUrl, '/api/health');
    assert.equal(first.response.status, 200);
    assert.equal(first.response.headers.get('ratelimit-limit'), '2');
    assert.equal(first.response.headers.get('ratelimit-remaining'), '1');

    const second = await requestJson(baseUrl, '/api/health');
    assert.equal(second.response.status, 200);
    assert.equal(second.response.headers.get('ratelimit-remaining'), '0');

    const third = await requestJson(baseUrl, '/api/health');
    assert.equal(third.response.status, 429);
    assert.equal(third.body.error.code, 'RATE_LIMITED');
    assert.ok(Number(third.response.headers.get('retry-after')) >= 1);
    assert.equal(third.response.headers.get('ratelimit-remaining'), '0');

    const stillBlocked = await requestJson(baseUrl, '/api/tasks');
    assert.equal(stillBlocked.response.status, 429);

    const root = await requestJson(baseUrl, '/');
    assert.equal(root.response.status, 200);
  });
});
