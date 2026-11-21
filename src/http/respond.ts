import type { IncomingMessage, ServerResponse } from 'node:http';

export type ResponseHeaders = Readonly<Record<string, string | undefined>>;

function applyHeaders(res: ServerResponse, headers?: ResponseHeaders): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value !== undefined) {
      res.setHeader(name, value);
    }
  }
}

/**
 * Send a JSON response. HEAD responses keep the same headers as GET but have no
 * body, as required by HTTP.
 */
export function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers?: ResponseHeaders,
): void {
  if (res.writableEnded) {
    return;
  }

  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new TypeError('Response payload is not JSON serializable');
  }
  const body = Buffer.from(serialized, 'utf8');

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

export function sendNoContent(
  req: IncomingMessage,
  res: ServerResponse,
  headers?: ResponseHeaders,
): void {
  if (res.writableEnded) {
    return;
  }

  res.statusCode = 204;
  applyHeaders(res, headers);
  res.end();
}
