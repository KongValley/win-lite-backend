'use strict';

const { TextDecoder } = require('node:util');
const {
  HttpError,
  badRequest,
  payloadTooLarge,
  unsupportedMediaType,
} = require('../lib/http-error');

const JSON_CONTENT_TYPE =
  /^\s*application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i;

function requestHasBody(req) {
  if (req.headers['transfer-encoding'] !== undefined) {
    return true;
  }

  const contentLength = req.headers['content-length'];
  if (contentLength === undefined) {
    return false;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * Read and parse a JSON request body with a hard size limit.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limitBytes
 * @returns {Promise<Record<string, unknown>>}
 */
function readJsonBody(req, limitBytes) {
  if (!requestHasBody(req)) {
    return Promise.resolve({});
  }

  const contentEncoding = req.headers['content-encoding'];
  if (
    contentEncoding !== undefined &&
    contentEncoding.trim().toLowerCase() !== 'identity'
  ) {
    return Promise.reject(
      unsupportedMediaType('Compressed request bodies are not supported'),
    );
  }

  const contentType = req.headers['content-type'] || '';
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    return Promise.reject(
      unsupportedMediaType('Content-Type must be application/json'),
    );
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    return Promise.reject(payloadTooLarge(limitBytes));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    function cleanup() {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      // Keep the error listener attached: a paused/aborted request can emit
      // ECONNRESET after the promise has settled, and an unhandled "error"
      // event on a stream would terminate the process.
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      // Do not keep buffering a body that is already over the limit. The error
      // response uses Connection: close, so the socket is discarded safely.
      req.pause();
      reject(error);
    }

    function onData(chunk) {
      totalBytes += chunk.length;
      if (totalBytes > limitBytes) {
        fail(payloadTooLarge(limitBytes));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      } catch {
        reject(badRequest('INVALID_ENCODING', 'Request body must be UTF-8'));
        return;
      }

      if (!text.trim()) {
        resolve({});
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        reject(badRequest('INVALID_JSON', 'Request body must be valid JSON'));
        return;
      }

      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(badRequest('INVALID_BODY', 'Request body must be a JSON object'));
        return;
      }

      resolve(parsed);
    }

    function onError() {
      fail(new HttpError(400, 'REQUEST_ERROR', 'Unable to read request body'));
    }

    function onAborted() {
      fail(new HttpError(400, 'REQUEST_ABORTED', 'Request was aborted'));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

module.exports = {
  JSON_CONTENT_TYPE,
  readJsonBody,
  requestHasBody,
};
