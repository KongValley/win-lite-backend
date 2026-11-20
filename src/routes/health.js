'use strict';

const { sendJson } = require('../http/respond');

function createHealthHandler(config) {
  return function health(ctx) {
    sendJson(ctx.req, ctx.res, 200, {
      status: 'ok',
      service: config.serviceName,
      version: config.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      },
    });
  };
}

module.exports = { createHealthHandler };
