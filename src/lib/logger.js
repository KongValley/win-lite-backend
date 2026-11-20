'use strict';

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const result = {
    name: error.name,
    message: error.message,
  };

  if (error.code !== undefined) {
    result.code = error.code;
  }
  if (error.stack) {
    result.stack = error.stack;
  }
  return result;
}

/**
 * Minimal structured JSON logger. Writes one object per line so the output can
 * be consumed by Windows services, containers and log collectors.
 */
function createLogger(options = {}) {
  const level = Object.prototype.hasOwnProperty.call(LEVELS, options.level)
    ? options.level
    : 'info';
  const stream = options.stream || process.stdout;
  const clock = options.clock || (() => new Date());
  const threshold = LEVELS[level];

  function write(levelName, message, fields) {
    if (LEVELS[levelName] < threshold) {
      return;
    }

    const entry = {
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

module.exports = {
  LEVELS,
  createLogger,
};
