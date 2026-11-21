import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from '../lib/http-error';

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function extractApiKey(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const header = req.headers['x-api-key'];
  if (typeof header === 'string') {
    return header.trim();
  }

  return null;
}

function unauthorized(message: string): HttpError {
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
export function createApiKeyVerifier(
  expectedApiKey: string,
): (req: IncomingMessage) => void {
  const expectedDigest = digest(expectedApiKey);

  return function verifyApiKey(req: IncomingMessage): void {
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
