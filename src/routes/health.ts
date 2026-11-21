import type { AppConfig } from '../config';
import type { RequestContext } from '../context';
import { sendJson } from '../http/respond';

export function createHealthHandler(
  config: AppConfig,
): (ctx: RequestContext) => void {
  return function health(ctx): void {
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
