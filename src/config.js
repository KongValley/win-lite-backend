'use strict';

const path = require('node:path');
const pkg = require('../package.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent']);

class ConfigError extends Error {
  constructor(messages) {
    super(`Invalid configuration:\n- ${messages.join('\n- ')}`);
    this.name = 'ConfigError';
    this.messages = messages;
  }
}

function readInteger(errors, env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    errors.push(`${name} must be an integer`);
    return fallback;
  }

  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }

  return value;
}

function readBoolean(errors, env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  errors.push(`${name} must be true or false`);
  return fallback;
}

function readCorsOrigins(errors, env) {
  const raw = env.CORS_ORIGIN;
  if (raw === undefined) {
    return ['*'];
  }

  const value = raw.trim();
  if (!value || value.toLowerCase() === 'none' || value.toLowerCase() === 'false') {
    return [];
  }

  const origins = [];
  for (const item of value.split(',')) {
    const origin = item.trim();
    if (!origin) {
      continue;
    }
    if (origin === '*') {
      return ['*'];
    }
    if (origin === 'null') {
      origins.push(origin);
      continue;
    }

    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/') {
        throw new Error('not an origin');
      }
      origins.push(parsed.origin);
    } catch {
      errors.push(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
  }

  return [...new Set(origins)];
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const errors = [];

  const host = (env.HOST === undefined ? '0.0.0.0' : env.HOST).trim();
  if (!host || /\s/.test(host)) {
    errors.push('HOST must be a non-empty hostname or IP address');
  }

  const port = readInteger(errors, env, 'PORT', 3000, 0, 65535);
  const requestTimeoutMs = readInteger(
    errors,
    env,
    'REQUEST_TIMEOUT_MS',
    30000,
    1000,
    300000,
  );
  const headersTimeoutMs = Math.min(
    readInteger(errors, env, 'HEADERS_TIMEOUT_MS', 15000, 1000, 120000),
    requestTimeoutMs,
  );
  const shutdownTimeoutMs = readInteger(
    errors,
    env,
    'SHUTDOWN_TIMEOUT_MS',
    10000,
    0,
    60000,
  );
  const bodyLimitBytes = readInteger(
    errors,
    env,
    'MAX_BODY_BYTES',
    1024 * 1024,
    1024,
    10 * 1024 * 1024,
  );
  const rateLimitWindowMs = readInteger(
    errors,
    env,
    'RATE_LIMIT_WINDOW_MS',
    60000,
    1000,
    24 * 60 * 60 * 1000,
  );
  const rateLimitMax = readInteger(errors, env, 'RATE_LIMIT_MAX', 300, 0, 1000000);
  const trustProxy = readBoolean(errors, env, 'TRUST_PROXY', false);
  const corsOrigins = readCorsOrigins(errors, env);

  const logLevel = (env.LOG_LEVEL === undefined ? 'info' : env.LOG_LEVEL)
    .trim()
    .toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${[...LOG_LEVELS].join(', ')}`);
  }

  const apiKey = (env.API_KEY || '').trim();
  if (apiKey && apiKey.length < 16) {
    errors.push('API_KEY must contain at least 16 characters when enabled');
  }
  if (apiKey.length > 512) {
    errors.push('API_KEY must not exceed 512 characters');
  }

  const dataFileValue =
    env.DATA_FILE === undefined || !env.DATA_FILE.trim()
      ? path.join('data', 'tasks.json')
      : env.DATA_FILE.trim();

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  return Object.freeze({
    serviceName: pkg.name,
    version: pkg.version,
    environment: (env.NODE_ENV || 'development').trim() || 'development',
    host,
    port,
    dataFile: path.resolve(projectRoot, dataFileValue),
    projectRoot,
    corsOrigins: Object.freeze(corsOrigins),
    corsMaxAgeSeconds: 600,
    apiKey,
    bodyLimitBytes,
    maxUrlLength: 4096,
    rateLimitWindowMs,
    rateLimitMax,
    trustProxy,
    logLevel,
    requestTimeoutMs,
    headersTimeoutMs,
    shutdownTimeoutMs,
  });
}

module.exports = {
  ConfigError,
  LOG_LEVELS,
  PROJECT_ROOT,
  loadConfig,
};
