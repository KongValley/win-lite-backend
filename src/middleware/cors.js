'use strict';

const { sendNoContent } = require('../http/respond');

const ALLOWED_METHODS = 'GET, HEAD, POST, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-API-Key';

function createCors(origins, maxAgeSeconds) {
  const enabled = origins.length > 0;
  const wildcard = origins.includes('*');

  function isAllowed(origin) {
    return wildcard || origins.includes(origin);
  }

  function apply(req, res) {
    if (!enabled) {
      return;
    }

    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && isAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', wildcard ? '*' : origin);
      res.setHeader(
        'Access-Control-Expose-Headers',
        'X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After',
      );
    }
  }

  function handlePreflight(req, res) {
    if (!enabled) {
      return false;
    }

    const requestedMethod = req.headers['access-control-request-method'];
    if (requestedMethod) {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
    }

    sendNoContent(req, res);
    return true;
  }

  return {
    enabled,
    apply,
    handlePreflight,
  };
}

module.exports = { createCors };
