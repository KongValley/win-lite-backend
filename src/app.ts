import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import type { AppConfig } from './config';
import type { RequestContext } from './context';
import { readJsonBody } from './http/body';
import { sendJson } from './http/respond';
import { METHOD_ORDER, Router, normalizePathname } from './http/router';
import { HttpError, methodNotAllowed, notFound } from './lib/http-error';
import type { Logger } from './lib/logger';
import { getClientIp } from './lib/network';
import { createApiKeyVerifier } from './middleware/auth';
import { createCors } from './middleware/cors';
import { RateLimiter } from './middleware/rate-limit';
import { registerRoutes } from './routes';
import type { TaskStore } from './store/task-store';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly store: TaskStore;
}

export interface App {
  handler(req: IncomingMessage, res: ServerResponse): void;
  close(): void;
  readonly router: Router;
}

interface RequestMeta {
  readonly requestId: string;
  readonly ip: string;
  readonly startedAt: number;
  pathname: string | null;
  routePath: string | null;
}

function applySecurityHeaders(res: ServerResponse, requestId: string): void {
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Cache-Control', 'no-store');
}

function buildAllowHeader(allowed: readonly string[], corsEnabled: boolean): string {
  const methods = new Set(allowed);
  if (methods.has('GET')) {
    methods.add('HEAD');
  }
  if (corsEnabled) {
    methods.add('OPTIONS');
  }
  return METHOD_ORDER.filter((method) => methods.has(method)).join(', ');
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function logPath(req: IncomingMessage): string {
  return String(req.url ?? '/')
    .split('?')[0]
    ?.slice(0, 4096) ?? '/';
}

export function createApp(options: CreateAppOptions): App {
  const { config, logger, store } = options;
  const router = new Router();
  registerRoutes(router, { config, store });

  const cors = createCors(config.corsOrigins, config.corsMaxAgeSeconds);
  const rateLimiter =
    config.rateLimitMax > 0
      ? new RateLimiter({
          windowMs: config.rateLimitWindowMs,
          max: config.rateLimitMax,
        })
      : null;
  const verifyApiKey = config.apiKey
    ? createApiKeyVerifier(config.apiKey)
    : null;

  function sendError(
    req: IncomingMessage,
    res: ServerResponse,
    error: unknown,
    meta: RequestMeta,
  ): void {
    if (res.writableEnded) {
      logger.error('request.error_after_response', {
        err: error,
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname ?? logPath(req),
      });
      return;
    }

    if (res.headersSent) {
      logger.error('request.error_after_headers', {
        err: error,
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname ?? logPath(req),
      });
      res.destroy();
      return;
    }

    const known =
      error instanceof HttpError && error.expose !== false ? error : null;
    const status =
      known && Number.isInteger(known.status) && known.status >= 400 && known.status <= 599
        ? known.status
        : 500;
    const code = known?.code ?? 'INTERNAL_ERROR';
    const message = known?.message ?? 'Internal server error';
    const details = known?.details;
    const headers = known?.headers ?? {};

    const logFields: Record<string, unknown> = {
      requestId: meta.requestId,
      method: req.method,
      path: meta.pathname ?? logPath(req),
      status,
      code,
    };

    if (status >= 500) {
      logger.error('request.failed', { ...logFields, err: error });
    } else {
      logger.debug('request.rejected', logFields);
    }

    const payload = {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      requestId: meta.requestId,
    };

    try {
      sendJson(req, res, status, payload, headers);
    } catch (responseError) {
      logger.error('response.failed', {
        err: responseError,
        requestId: meta.requestId,
      });
      res.destroy();
    }
  }

  async function dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    meta: RequestMeta,
  ): Promise<void> {
    applySecurityHeaders(res, meta.requestId);

    try {
      const rawUrl = req.url ?? '/';
      if (Buffer.byteLength(rawUrl, 'utf8') > config.maxUrlLength) {
        throw new HttpError(
          414,
          'URI_TOO_LONG',
          `Request URL must not exceed ${config.maxUrlLength} bytes`,
        );
      }

      let url: URL;
      try {
        url = new URL(rawUrl, 'http://localhost');
      } catch {
        throw new HttpError(400, 'INVALID_URL', 'Request URL is invalid');
      }

      const pathname = normalizePathname(url.pathname);
      meta.pathname = pathname;

      cors.apply(req, res);

      if (req.method === 'OPTIONS' && cors.handlePreflight(req, res)) {
        return;
      }

      if (rateLimiter && isApiPath(pathname)) {
        const result = rateLimiter.check(meta.ip);
        res.setHeader('RateLimit-Limit', String(result.limit));
        res.setHeader('RateLimit-Remaining', String(result.remaining));
        res.setHeader('RateLimit-Reset', String(result.retryAfter));

        if (!result.allowed) {
          throw new HttpError(429, 'RATE_LIMITED', 'Too many requests', {
            headers: { 'Retry-After': String(result.retryAfter) },
          });
        }
      }

      const method = req.method ?? 'GET';
      const match = router.match(method, pathname);
      const route = match.route;
      meta.routePath = route?.path ?? null;

      if (!route) {
        if (match.pathMatched) {
          throw methodNotAllowed(buildAllowHeader(match.allowed, cors.enabled));
        }
        throw notFound('ROUTE_NOT_FOUND', 'Route not found');
      }

      if (verifyApiKey && isApiPath(pathname) && route.options.public !== true) {
        verifyApiKey(req);
      }

      let body: Record<string, unknown> = {};
      if (BODY_METHODS.has(method)) {
        body = await readJsonBody(req, config.bodyLimitBytes);
      }

      const context: RequestContext = {
        req,
        res,
        url,
        pathname,
        params: match.params ?? {},
        body,
        requestId: meta.requestId,
        ip: meta.ip,
        logger,
        config,
        store,
      };

      await route.handler(context);

      if (!res.writableEnded) {
        throw new Error(
          `Route handler did not send a response: ${method} ${pathname}`,
        );
      }
    } catch (error) {
      sendError(req, res, error, meta);
    }
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    const meta: RequestMeta = {
      requestId: randomUUID(),
      ip: getClientIp(req, config.trustProxy),
      startedAt: performance.now(),
      pathname: null,
      routePath: null,
    };
    let logged = false;

    function finalize(aborted: boolean): void {
      if (logged) {
        return;
      }
      logged = true;

      const fields: Record<string, unknown> = {
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname ?? logPath(req),
        status: res.statusCode,
        durationMs: Math.round((performance.now() - meta.startedAt) * 10) / 10,
        contentLength: Number(res.getHeader('Content-Length')) || 0,
        ip: meta.ip,
      };
      if (meta.routePath) {
        fields.route = meta.routePath;
      }

      if (aborted) {
        fields.aborted = true;
        logger.warn('request.aborted', fields);
      } else {
        logger.info('request.completed', fields);
      }
    }

    req.once('error', (error) => {
      logger.debug('request.error', { err: error, requestId: meta.requestId });
    });
    res.once('finish', () => finalize(false));
    res.once('close', () => {
      if (!res.writableFinished) {
        finalize(true);
      }
    });
    res.once('error', (error) => {
      logger.debug('response.error', { err: error, requestId: meta.requestId });
    });

    dispatch(req, res, meta).catch((error: unknown) => {
      logger.error('request.fatal_error', {
        err: error,
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname ?? logPath(req),
      });

      if (res.writableEnded) {
        return;
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }

      try {
        applySecurityHeaders(res, meta.requestId);
        sendJson(req, res, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
          requestId: meta.requestId,
        });
      } catch {
        res.destroy();
      }
    });
  }

  function close(): void {
    if (rateLimiter) {
      rateLimiter.close();
    }
  }

  return {
    handler,
    close,
    router,
  };
}
