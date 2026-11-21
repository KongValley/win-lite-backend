import path from 'node:path';
import { LOG_LEVELS, isLogLevel, type LogLevel } from './lib/logger';
import { PACKAGE_METADATA, PROJECT_ROOT } from './lib/project';

export { LOG_LEVELS, PROJECT_ROOT };

export interface AppConfig {
  readonly serviceName: string;
  readonly version: string;
  readonly environment: string;
  readonly host: string;
  readonly port: number;
  readonly dataFile: string;
  readonly projectRoot: string;
  readonly corsOrigins: readonly string[];
  readonly corsMaxAgeSeconds: number;
  readonly apiKey: string;
  readonly bodyLimitBytes: number;
  readonly maxUrlLength: number;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly trustProxy: boolean;
  readonly logLevel: LogLevel;
  readonly requestTimeoutMs: number;
  readonly headersTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly projectRoot?: string;
}

export class ConfigError extends Error {
  readonly messages: readonly string[];

  constructor(messages: readonly string[]) {
    super(`Invalid configuration:\n- ${messages.join('\n- ')}`);
    this.name = 'ConfigError';
    this.messages = messages;
  }
}

function readInteger(
  errors: string[],
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
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

function readBoolean(
  errors: string[],
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
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

function readCorsOrigins(errors: string[], env: NodeJS.ProcessEnv): string[] {
  const raw = env.CORS_ORIGIN;
  if (raw === undefined) {
    return ['*'];
  }

  const value = raw.trim();
  if (!value || value.toLowerCase() === 'none' || value.toLowerCase() === 'false') {
    return [];
  }

  const origins: string[] = [];
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

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const projectRoot = path.resolve(options.projectRoot ?? PROJECT_ROOT);
  const errors: string[] = [];

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

  const logLevelValue = (env.LOG_LEVEL === undefined ? 'info' : env.LOG_LEVEL)
    .trim()
    .toLowerCase();
  const logLevel: LogLevel = isLogLevel(logLevelValue) ? logLevelValue : 'info';
  if (!isLogLevel(logLevelValue)) {
    errors.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const apiKey = (env.API_KEY ?? '').trim();
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
    serviceName: PACKAGE_METADATA.name,
    version: PACKAGE_METADATA.version,
    environment: (env.NODE_ENV ?? 'development').trim() || 'development',
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
