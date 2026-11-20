'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Router, METHOD_ORDER, normalizePathname } = require('./http/router');
const { readJsonBody } = require('./http/body');
const { sendJson } = require('./http/respond');
const {
  HttpError,
  notFound,
  methodNotAllowed,
} = require('./lib/http-error');
const { getClientIp } = require('./lib/network');
const { createCors } = require('./middleware/cors');
const { createApiKeyVerifier } = require('./middleware/auth');
const { RateLimiter } = require('./middleware/rate-limit');
const { registerRoutes } = require('./routes');

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function applySecurityHeaders(res, requestId) {
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

function buildAllowHeader(allowed, corsEnabled) {
  const methods = new Set(allowed);
  if (methods.has('GET')) {
    methods.add('HEAD');
  }
  if (corsEnabled) {
    methods.add('OPTIONS');
  }
  return METHOD_ORDER.filter((method) => methods.has(method)).join(', ');
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function logPath(req) {
  return String(req.url || '/')
    .split('?')[0]
    .slice(0, 4096);
}

function createApp(options) {
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

  function sendError(req, res, error, meta) {
    if (res.writableEnded) {
      logger.error('request.error_after_response', {
        err: error,
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname || logPath(req),
      });
      return;
    }

    if (res.headersSent) {
      logger.error('request.error_after_headers', {
        err: error,
        requestId: meta.requestId,
        method: req.method,
        path: meta.pathname || logPath(req),
      });
      res.destroy();
      return;
    }

    const known = error instanceof HttpError && error.expose !== false;
    const status =
      known && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
    const code = known ? error.code : 'INTERNAL_ERROR';
    const message = known ? error.message : 'Internal server error';
    const details = known ? error.details : undefined;
    const headers = known ? error.headers : {};

    const logFields = {
      requestId: meta.requestId,
      method: req.method,
      path: meta.pathname || logPath(req),
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

  async function dispatch(req, res, meta) {
    applySecurityHeaders(res, meta.requestId);

    try {
      const rawUrl = req.url || '/';
      if (Buffer.byteLength(rawUrl, 'utf8') > config.maxUrlLength) {
        throw new HttpError(
          414,
          'URI_TOO_LONG',
          `Request URL must not exceed ${config.maxUrlLength} bytes`,
        );
      }

      let url;
      try {
        url = new URL(rawUrl, 'http://localhost');
      } catch {
        throw new HttpError(400, 'INVALID_URL', 'Request URL is invalid');
      }

      const pathname = normalizePathname(url.pathname);
      meta.pathname = pathname;
      meta.url = url;

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

      const match = router.match(req.method, pathname);
      meta.routePath = match.route ? match.route.path : null;

      if (!match.route) {
        if (match.pathMatched) {
          throw methodNotAllowed(buildAllowHeader(match.allowed, cors.enabled));
        }
        throw notFound('ROUTE_NOT_FOUND', 'Route not found');
      }

      if (
        verifyApiKey &&
        isApiPath(pathname) &&
        match.route.options.public !== true
      ) {
        verifyApiKey(req);
      }

      let body = {};
      if (BODY_METHODS.has(req.method)) {
        body = await readJsonBody(req, config.bodyLimitBytes);
      }

      const context = {
        req,
        res,
        url,
        pathname,
        params: match.params,
        body,
        requestId: meta.requestId,
        ip: meta.ip,
        logger,
        config,
        store,
      };

      await match.route.handler(context);

      if (!res.writableEnded) {
        throw new Error(
          `Route handler did not send a response: ${req.method} ${pathname}`,
        );
      }
    } catch (error) {
      sendError(req, res, error, meta);
    }
  }

  function handler(req, res) {
    const requestId = crypto.randomUUID();
    const meta = {
      requestId,
      ip: getClientIp(req, config.trustProxy),
      startedAt: performance.now(),
      pathname: null,
      routePath: null,
    };
    let logged = false;

    function finalize(aborted) {
      if (logged) {
        return;
      }
      logged = true;

      const fields = {
        requestId,
        method: req.method,
        path: meta.pathname || logPath(req),
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
      logger.debug('request.error', { err: error, requestId });
    });
    res.once('finish', () => finalize(false));
    res.once('close', () => {
      if (!res.writableFinished) {
        finalize(true);
      }
    });
    res.once('error', (error) => {
      logger.debug('response.error', { err: error, requestId });
    });

    dispatch(req, res, meta).catch((error) => {
      logger.error('request.fatal_error', {
        err: error,
        requestId,
        method: req.method,
        path: meta.pathname || logPath(req),
      });

      if (res.writableEnded) {
        return;
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }

      try {
        applySecurityHeaders(res, requestId);
        sendJson(req, res, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
          requestId,
        });
      } catch {
        res.destroy();
      }
    });
  }

  function close() {
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

module.exports = { createApp };
