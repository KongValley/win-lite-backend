import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendNoContent } from '../http/respond';

const ALLOWED_METHODS = 'GET, HEAD, POST, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-API-Key';

export interface Cors {
  readonly enabled: boolean;
  apply(req: IncomingMessage, res: ServerResponse): void;
  handlePreflight(req: IncomingMessage, res: ServerResponse): boolean;
}

export function createCors(
  origins: readonly string[],
  maxAgeSeconds: number,
): Cors {
  const enabled = origins.length > 0;
  const wildcard = origins.includes('*');

  function isAllowed(origin: string): boolean {
    return wildcard || origins.includes(origin);
  }

  function apply(req: IncomingMessage, res: ServerResponse): void {
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

  function handlePreflight(req: IncomingMessage, res: ServerResponse): boolean {
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
