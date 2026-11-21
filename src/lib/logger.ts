export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_VALUES: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly stream?: NodeJS.WritableStream;
  readonly clock?: () => Date;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if ('code' in error && error.code !== undefined) {
    result.code = error.code;
  }
  if (error.stack) {
    result.stack = error.stack;
  }
  return result;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === 'string' &&
    (LOG_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Minimal structured JSON logger. Writes one object per line so the output can
 * be consumed by Windows services, containers and log collectors.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = isLogLevel(options.level) ? options.level : 'info';
  const stream = options.stream ?? process.stdout;
  const clock = options.clock ?? (() => new Date());
  const threshold = LEVEL_VALUES[level];

  function write(
    levelName: Exclude<LogLevel, 'silent'>,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_VALUES[levelName] < threshold) {
      return;
    }

    const entry: Record<string, unknown> = {
      time: clock().toISOString(),
      level: levelName,
      msg: message,
    };

    if (fields && typeof fields === 'object') {
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'err') {
          entry.err = serializeError(value);
        } else {
          entry[key] = value;
        }
      }
    }

    try {
      stream.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // A closed stdout/stderr (for example during shutdown) must never crash
      // the request that was being logged.
    }
  }

  return {
    level,
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
