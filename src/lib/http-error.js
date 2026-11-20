'use strict';

/**
 * An error that is safe to expose to HTTP clients.
 * Anything else is reported as a generic 500 response.
 */
class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers || {};
    this.expose = options.expose !== false;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}

function badRequest(code, message, details) {
  return new HttpError(400, code, message, { details });
}

function notFound(code = 'NOT_FOUND', message = 'Resource not found') {
  return new HttpError(404, code, message);
}

function methodNotAllowed(allow) {
  return new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
    headers: { Allow: allow },
  });
}

function payloadTooLarge(limitBytes) {
  return new HttpError(
    413,
    'PAYLOAD_TOO_LARGE',
    `Request body exceeds the ${limitBytes} byte limit`,
    { headers: { Connection: 'close' } },
  );
}

function unsupportedMediaType(message) {
  return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
}

module.exports = {
  HttpError,
  badRequest,
  notFound,
  methodNotAllowed,
  payloadTooLarge,
  unsupportedMediaType,
};
