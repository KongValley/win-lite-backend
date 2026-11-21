import { HttpError } from '../lib/http-error';
import type { RouteHandler, RouteOptions } from '../context';

const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

export const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

interface StaticSegment {
  readonly type: 'static';
  readonly value: string;
}

interface ParamSegment {
  readonly type: 'param';
  readonly name: string;
}

type RouteSegment = StaticSegment | ParamSegment;

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly segments: RouteSegment[];
  readonly staticSegments: number;
  readonly handler: RouteHandler;
  readonly options: RouteOptions;
}

export interface RouteMatch {
  readonly route: Route | null;
  readonly params: Record<string, string> | null;
  readonly allowed: string[];
  readonly pathMatched: boolean;
}

function compilePath(pathname: string): RouteSegment[] {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    throw new TypeError('Route path must start with "/"');
  }

  if (pathname === '/') {
    return [];
  }

  return pathname
    .slice(1)
    .split('/')
    .map((part): RouteSegment => {
      if (part.startsWith(':')) {
        const name = part.slice(1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw new TypeError(`Invalid route parameter name: ${part}`);
        }
        return { type: 'param', name };
      }
      return { type: 'static', value: part };
    });
}

function splitPath(pathname: string): string[] {
  if (pathname === '/') {
    return [];
  }
  return pathname.slice(1).split('/');
}

function matchSegments(
  routeSegments: readonly RouteSegment[],
  pathSegments: readonly string[],
): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) {
    return null;
  }

  const params = Object.create(null) as Record<string, string>;

  for (let index = 0; index < routeSegments.length; index += 1) {
    const routePart = routeSegments[index];
    const pathPart = pathSegments[index];
    if (!routePart || !pathPart) {
      return null;
    }

    if (routePart.type === 'static') {
      if (routePart.value !== pathPart) {
        return null;
      }
      continue;
    }

    try {
      params[routePart.name] = decodeURIComponent(pathPart);
    } catch {
      throw new HttpError(400, 'INVALID_PATH', 'Path contains invalid URL encoding');
    }
  }

  return params;
}

/**
 * Tiny path router. Static routes automatically win over parameterised routes,
 * regardless of registration order.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(
    method: string,
    pathname: string,
    handler: RouteHandler,
    options: RouteOptions = {},
  ): this {
    const normalizedMethod = String(method).toUpperCase();
    if (!HTTP_METHODS.has(normalizedMethod)) {
      throw new TypeError(`Unsupported HTTP method: ${method}`);
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Route handler must be a function');
    }

    const segments = compilePath(pathname);
    this.routes.push({
      method: normalizedMethod,
      path: pathname,
      segments,
      staticSegments: segments.filter((part) => part.type === 'static').length,
      handler,
      options,
    });
    return this;
  }

  get(pathname: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('GET', pathname, handler, options);
  }

  post(pathname: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('POST', pathname, handler, options);
  }

  put(pathname: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('PUT', pathname, handler, options);
  }

  patch(pathname: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('PATCH', pathname, handler, options);
  }

  delete(pathname: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('DELETE', pathname, handler, options);
  }

  match(method: string, pathname: string): RouteMatch {
    const requestMethod = method === 'HEAD' ? 'GET' : method;
    const pathSegments = splitPath(pathname);
    const allowed = new Set<string>();
    let best: { route: Route; params: Record<string, string>; index: number } | null =
      null;

    for (let index = 0; index < this.routes.length; index += 1) {
      const route = this.routes[index];
      if (!route) {
        continue;
      }
      const params = matchSegments(route.segments, pathSegments);

      if (params === null) {
        continue;
      }

      allowed.add(route.method);

      if (route.method !== requestMethod) {
        continue;
      }

      if (
        best === null ||
        route.staticSegments > best.route.staticSegments ||
        (route.staticSegments === best.route.staticSegments && index < best.index)
      ) {
        best = { route, params, index };
      }
    }

    return {
      route: best?.route ?? null,
      params: best?.params ?? null,
      allowed: METHOD_ORDER.filter((name) => allowed.has(name)),
      pathMatched: allowed.size > 0,
    };
  }
}

export function normalizePathname(pathname: string): string {
  if (pathname.length > 1) {
    let end = pathname.length;
    while (end > 1 && pathname.charCodeAt(end - 1) === 0x2f) {
      end -= 1;
    }
    if (end !== pathname.length) {
      return pathname.slice(0, end) || '/';
    }
  }
  return pathname;
}
