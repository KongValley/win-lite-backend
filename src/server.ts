import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type App } from './app';
import type { AppConfig } from './config';
import { getErrorCode } from './lib/errors';
import type { Logger } from './lib/logger';
import { TaskStore } from './store/task-store';

export interface CreateRuntimeOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
}

export interface Runtime {
  readonly server: Server;
  readonly app: App;
  readonly store: TaskStore;
  readonly config: AppConfig;
  readonly logger: Logger;
  listen(port?: number, host?: string): Promise<AddressInfo>;
  stop(): Promise<void>;
  getAddress(): AddressInfo | null;
}

export interface StartedRuntime extends Runtime {
  readonly address: AddressInfo;
}

function formatLocalUrl(host: string, port: number): string {
  const localHost =
    host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
  const bracketed = localHost.includes(':') ? `[${localHost}]` : localHost;
  return `http://${bracketed}:${port}`;
}

export async function createRuntime(
  options: CreateRuntimeOptions,
): Promise<Runtime> {
  const { config, logger } = options;
  const store = new TaskStore({ filePath: config.dataFile });
  await store.init();

  const app = createApp({ config, logger, store });
  const server = http.createServer((req, res) => app.handler(req, res));

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = Math.min(5000, config.requestTimeoutMs);
  server.maxHeadersCount = 2000;

  server.on('clientError', (error, socket) => {
    if (getErrorCode(error) === 'ECONNRESET' || !socket.writable) {
      return;
    }

    logger.debug('server.client_error', { err: error });
    const statusLine =
      getErrorCode(error) === 'HPE_HEADER_OVERFLOW'
        ? '431 Request Header Fields Too Large'
        : '400 Bad Request';
    socket.end(
      `HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });

  let stopping: Promise<void> | null = null;
  let address: AddressInfo | null = null;

  function listen(port = config.port, host = config.host): Promise<AddressInfo> {
    return new Promise<AddressInfo>((resolve, reject) => {
      function onError(error: Error): void {
        server.off('listening', onListening);
        reject(error);
      }

      function onListening(): void {
        server.off('error', onError);
        const boundAddress = server.address();
        if (!boundAddress || typeof boundAddress === 'string') {
          reject(new Error('Server did not bind to a TCP address'));
          return;
        }
        address = boundAddress;
        server.on('error', (error) => {
          logger.error('server.error', { err: error });
        });
        resolve(boundAddress);
      }

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  function stop(): Promise<void> {
    if (stopping) {
      return stopping;
    }

    stopping = (async () => {
      app.close();

      if (server.listening) {
        await new Promise<void>((resolve) => {
          let finished = false;
          let timer: NodeJS.Timeout;

          function finish(): void {
            if (finished) {
              return;
            }
            finished = true;
            clearTimeout(timer);
            resolve();
          }

          timer = setTimeout(() => {
            logger.warn('server.force_close', {
              timeoutMs: config.shutdownTimeoutMs,
            });
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
            finish();
          }, config.shutdownTimeoutMs);
          timer.unref();

          server.close(finish);
          if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
          }
        });
      }

      await store.flush();
    })();

    return stopping;
  }

  return {
    server,
    app,
    store,
    config,
    logger,
    listen,
    stop,
    getAddress: () => address,
  };
}

export async function startServer(
  options: CreateRuntimeOptions,
): Promise<StartedRuntime> {
  const { config, logger } = options;
  const runtime = await createRuntime({ config, logger });

  try {
    const address = await runtime.listen();
    logger.info('server.started', {
      service: config.serviceName,
      version: config.version,
      url: formatLocalUrl(config.host, address.port),
      host: config.host,
      port: address.port,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      dataFile: config.dataFile,
      authentication: config.apiKey ? 'enabled' : 'disabled',
      cors: config.corsOrigins,
      rateLimitPerWindow: config.rateLimitMax,
      rateLimitWindowMs: config.rateLimitWindowMs,
    });
    return { ...runtime, address };
  } catch (error) {
    await runtime.stop().catch(() => {});
    throw error;
  }
}

export { formatLocalUrl };
