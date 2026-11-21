import type { IncomingMessage } from 'node:http';

function trimForwardedAddress(value: string): string | null {
  const first = value.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first.slice(0, 128) : null;
}

/**
 * Resolve the client address used for rate limiting and request logs. Forwarded
 * headers are only trusted when TRUST_PROXY=true, because clients can forge them.
 */
export function getClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const address = trimForwardedAddress(forwarded);
      if (address) {
        return address;
      }
    }
  }

  const address = req.socket.remoteAddress;
  if (!address) {
    return 'unknown';
  }

  return address.startsWith('::ffff:') ? address.slice(7) : address;
}
