'use strict';

const os = require('node:os');
const { sendJson } = require('../http/respond');

function createSystemHandler(config) {
  return function systemInfo(ctx) {
    const memory = process.memoryUsage();

    sendJson(ctx.req, ctx.res, 200, {
      data: {
        runtime: {
          node: process.version,
          v8: process.versions.v8,
          platform: process.platform,
          arch: process.arch,
          is32Bit: process.arch === 'ia32',
          pid: process.pid,
          uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
        },
        os: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpuCount: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
          uptimeSeconds: Math.round(os.uptime()),
        },
        processMemory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
        },
        // These two variables are only populated by Windows and make it easier
        // to distinguish a true 32-bit OS from a 32-bit process on 64-bit Windows.
        windows: {
          processorArchitecture: process.env.PROCESSOR_ARCHITECTURE || null,
          processorArchitectureW6432:
            process.env.PROCESSOR_ARCHITEW6432 || null,
        },
        service: {
          name: config.serviceName,
          version: config.version,
          environment: config.environment,
        },
      },
    });
  };
}

module.exports = { createSystemHandler };
