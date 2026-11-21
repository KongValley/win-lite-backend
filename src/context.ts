import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { AppConfig } from './config';
import type { Logger } from './lib/logger';
import type { TaskStore } from './store/task-store';

export interface RouteOptions {
  readonly public?: boolean;
}

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly pathname: string;
  readonly params: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly requestId: string;
  readonly ip: string;
  readonly logger: Logger;
  readonly config: AppConfig;
  readonly store: TaskStore;
}

export type RouteHandler = (ctx: RequestContext) => void | Promise<void>;
