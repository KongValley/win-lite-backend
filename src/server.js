'use strict';

const http = require('node:http');
const { createApp } = require('./app');
const { TaskStore } = require('./store/task-store');

function formatLocalUrl(host, port) {
  const localHost =
    host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
  const bracketed = localHost.includes(':') ? `[${localHost}]` : localHost;
  return `http://${bracketed}:${port}`;
}

async function createRuntime(options) {
  const { config, logger } = options;
  const store = new TaskStore({ filePath: config.dataFile, logger });
  await store.init();

  const app = createApp({ config, logger, store });
  const server = http.createServer((req, res) => app.handler(req, res));

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = Math.min(5000, config.requestTimeoutMs);
  server.maxHeadersCount = 2000;

  server.on('clientError', (error, socket) => {
    if (error.code === 'ECONNRESET' || !socket.writable) {
      return;
    }

    logger.debug('server.client_error', { err: error });
    const statusLine =
      error.code === 'HPE_HEADER_OVERFLOW'
        ? '431 Request Header Fields Too Large'
        : '400 Bad Request';
    socket.end(
      `HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });

  let stopping = null;
  let address = null;

  function listen(port = config.port, host = config.host) {
    return new Promise((resolve, reject) => {
      function onError(error) {
        server.off('listening', onListening);
        reject(error);
      }

      function onListening() {
        server.off('error', onError);
        address = server.address();
        server.on('error', (error) => {
          logger.error('server.error', { err: error });
        });
        resolve(address);
      }

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  function stop() {
    if (stopping) {
      return stopping;
    }

    stopping = (async () => {
      app.close();

      if (server.listening) {
        await new Promise((resolve) => {
          let finished = false;

          function finish() {
            if (finished) {
              return;
            }
            finished = true;
            clearTimeout(timer);
            resolve();
          }

          const timer = setTimeout(() => {
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

async function startServer(options) {
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

module.exports = {
  createRuntime,
  formatLocalUrl,
  startServer,
};
