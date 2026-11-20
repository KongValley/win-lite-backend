'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('../lib/http-error');

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function extractApiKey(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) {
      return match[1].trim();
    }
  }

  const header = req.headers['x-api-key'];
  if (typeof header === 'string') {
    return header.trim();
  }

  return null;
}

function unauthorized(message) {
  return new HttpError(401, 'UNAUTHORIZED', message, {
    headers: {
      'WWW-Authenticate': 'Bearer realm="api"',
    },
  });
}

/**
 * Constant-time API key verification. SHA-256 digests give both values the same
 * length, so the comparison does not leak the configured key's length.
 */
function createApiKeyVerifier(expectedApiKey) {
  const expectedDigest = digest(expectedApiKey);

  return function verifyApiKey(req) {
    const presented = extractApiKey(req);
    if (!presented) {
      throw unauthorized('API key required');
    }

    const presentedDigest = digest(presented);
    if (!crypto.timingSafeEqual(presentedDigest, expectedDigest)) {
      throw unauthorized('Invalid API key');
    }
  };
}

module.exports = {
  createApiKeyVerifier,
  extractApiKey,
};
