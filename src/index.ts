import path from 'node:path';
import { PROJECT_ROOT, loadConfig } from './config';
import { loadEnvFile } from './lib/env-file';
import { getErrorCode, getErrorMessage, getErrorStack } from './lib/errors';
import { createLogger } from './lib/logger';
import { assertSupportedNodeVersion } from './lib/runtime';
import { startServer } from './server';

async function main(): Promise<void> {
  assertSupportedNodeVersion();

  try {
    loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  } catch (error) {
    console.error(`[config] Unable to load .env: ${getErrorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`[config] ${getErrorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const runtime = await startServer({ config, logger });

  let shuttingDown = false;

  async function shutdown(reason: string, exitCode: number): Promise<void> {
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

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
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

  // Tell PM2 (or another IPC parent) that the server is listening. The PM2
  // ecosystem config uses wait_ready so restarts wait for this signal.
  if (typeof process.send === 'function') {
    try {
      process.send('ready');
    } catch (error) {
      logger.warn('process.ready_signal_failed', { err: error });
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[startup] ${getErrorMessage(error)}`);

  if (getErrorCode(error) === 'EADDRINUSE') {
    console.error(
      '[startup] The port is already in use. Change PORT in .env or stop the other process.',
    );
  }

  if (process.env.DEBUG) {
    console.error(getErrorStack(error));
  }

  process.exitCode = 1;
});
