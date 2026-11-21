export type HttpHeaders = Record<string, string>;

export interface HttpErrorOptions {
  readonly details?: unknown;
  readonly headers?: HttpHeaders;
  readonly expose?: boolean;
}

/**
 * An error that is safe to expose to HTTP clients.
 * Anything else is reported as a generic 500 response.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly headers: HttpHeaders;
  readonly expose: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
    this.expose = options.expose !== false;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}

export function badRequest(
  code: string,
  message: string,
  details?: unknown,
): HttpError {
  return new HttpError(400, code, message, { details });
}

export function notFound(code = 'NOT_FOUND', message = 'Resource not found'): HttpError {
  return new HttpError(404, code, message);
}

export function methodNotAllowed(allow: string): HttpError {
  return new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
    headers: { Allow: allow },
  });
}

export function payloadTooLarge(limitBytes: number): HttpError {
  return new HttpError(
    413,
    'PAYLOAD_TOO_LARGE',
    `Request body exceeds the ${limitBytes} byte limit`,
    { headers: { Connection: 'close' } },
  );
}

export function unsupportedMediaType(message: string): HttpError {
  return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
}
