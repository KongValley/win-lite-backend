import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RouteHandler } from '../src/context';
import { HttpError } from '../src/lib/http-error';
import { Router, normalizePathname } from '../src/http/router';

const handler: RouteHandler = () => {};

test('prefers static routes over parameter routes', () => {
  const router = new Router();
  router.get('/api/tasks/:id', handler);
  router.get('/api/tasks/stats', handler);

  const staticMatch = router.match('GET', '/api/tasks/stats');
  assert.ok(staticMatch.route);
  assert.equal(staticMatch.route.path, '/api/tasks/stats');

  const dynamicMatch = router.match('GET', '/api/tasks/abc');
  assert.ok(dynamicMatch.route);
  assert.ok(dynamicMatch.params);
  assert.equal(dynamicMatch.route.path, '/api/tasks/:id');
  assert.equal(dynamicMatch.params.id, 'abc');
});

test('maps HEAD to GET and reports allowed methods for 405', () => {
  const router = new Router();
  router.get('/api/tasks', handler);
  router.post('/api/tasks', handler);

  const head = router.match('HEAD', '/api/tasks');
  assert.ok(head.route);
  assert.equal(head.route.path, '/api/tasks');

  const notAllowed = router.match('PUT', '/api/tasks');
  assert.equal(notAllowed.route, null);
  assert.equal(notAllowed.pathMatched, true);
  assert.deepEqual(notAllowed.allowed, ['GET', 'POST']);

  const missing = router.match('GET', '/api/missing');
  assert.equal(missing.pathMatched, false);
  assert.deepEqual(missing.allowed, []);
});

test('decodes parameters and rejects invalid URL encoding', () => {
  const router = new Router();
  router.get('/files/:name', handler);

  const match = router.match('GET', '/files/hello%20world');
  assert.ok(match.params);
  assert.equal(match.params.name, 'hello world');

  assert.throws(
    () => router.match('GET', '/files/%E0%A4%A'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_PATH');
      return true;
    },
  );
});

test('normalises trailing slashes without changing the root path', () => {
  assert.equal(normalizePathname('/api/tasks/'), '/api/tasks');
  assert.equal(normalizePathname('/api/tasks///'), '/api/tasks');
  assert.equal(normalizePathname('/'), '/');
});
