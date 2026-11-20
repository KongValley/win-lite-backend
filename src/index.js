'use strict';

const path = require('node:path');
const { loadConfig, PROJECT_ROOT } = require('./config');
const { loadEnvFile } = require('./lib/env-file');
const { createLogger } = require('./lib/logger');
const { assertSupportedNodeVersion } = require('./lib/runtime');
const { startServer } = require('./server');

async function main() {
  assertSupportedNodeVersion();

  try {
    loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  } catch (error) {
    console.error(`[config] Unable to load .env: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`[config] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const runtime = await startServer({ config, logger });

  let shuttingDown = false;

  async function shutdown(reason, exitCode) {
    if (shuttingDown) {
      logger.warn('server.shutdown_already_in_progress', { reason });
      return;
    }
    shuttingDown = true;

    logger.info('server.stopping', { reason });
    try {
      await runtime.stop();
      logger.info('server.stopped', { reason });
    } catch (error) {
      logger.error('server.stop_failed', { err: error });
      process.exitCode = 1;
      return;
    }

    process.exitCode = exitCode;
  }

  const signals = ['SIGINT', 'SIGTERM'];
  if (process.platform === 'win32') {
    signals.push('SIGBREAK');
  }

  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(signal, 0);
    });
  }

  process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { err: error });
    void shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', { err: reason });
    void shutdown('unhandledRejection', 1);
  });
}

main().catch((error) => {
  console.error(`[startup] ${error.message}`);

  if (error.code === 'EADDRINUSE') {
    console.error(
      '[startup] The port is already in use. Change PORT in .env or stop the other process.',
    );
  }

  if (process.env.DEBUG) {
    console.error(error.stack);
  }

  process.exitCode = 1;
});
