'use strict';

function applyHeaders(res, headers) {
  for (const [name, value] of Object.entries(headers || {})) {
    if (value !== undefined) {
      res.setHeader(name, value);
    }
  }
}

/**
 * Send a JSON response. HEAD responses keep the same headers as GET but have no
 * body, as required by HTTP.
 */
function sendJson(req, res, status, payload, headers) {
  if (res.writableEnded) {
    return;
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8');

  res.statusCode = status;
  applyHeaders(res, headers);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);

  if (req.method === 'HEAD' || status === 204 || status === 304) {
    res.end();
    return;
  }

  res.end(body);
}

function sendNoContent(req, res, headers) {
  if (res.writableEnded) {
    return;
  }

  res.statusCode = 204;
  applyHeaders(res, headers);
  res.end();
}

module.exports = {
  sendJson,
  sendNoContent,
};
