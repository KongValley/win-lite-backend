'use strict';

const { HttpError } = require('../lib/http-error');

const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function compilePath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    throw new TypeError('Route path must start with "/"');
  }

  if (pathname === '/') {
    return [];
  }

  return pathname
    .slice(1)
    .split('/')
    .map((part) => {
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

function splitPath(pathname) {
  if (pathname === '/') {
    return [];
  }
  return pathname.slice(1).split('/');
}

function matchSegments(routeSegments, pathSegments) {
  if (routeSegments.length !== pathSegments.length) {
    return null;
  }

  const params = Object.create(null);

  for (let index = 0; index < routeSegments.length; index += 1) {
    const routePart = routeSegments[index];
    const pathPart = pathSegments[index];

    if (!pathPart) {
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
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pathname, handler, options = {}) {
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

  get(pathname, handler, options) {
    return this.add('GET', pathname, handler, options);
  }

  post(pathname, handler, options) {
    return this.add('POST', pathname, handler, options);
  }

  put(pathname, handler, options) {
    return this.add('PUT', pathname, handler, options);
  }

  patch(pathname, handler, options) {
    return this.add('PATCH', pathname, handler, options);
  }

  delete(pathname, handler, options) {
    return this.add('DELETE', pathname, handler, options);
  }

  match(method, pathname) {
    const requestMethod = method === 'HEAD' ? 'GET' : method;
    const pathSegments = splitPath(pathname);
    const allowed = new Set();
    let best = null;

    for (let index = 0; index < this.routes.length; index += 1) {
      const route = this.routes[index];
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
      route: best ? best.route : null,
      params: best ? best.params : null,
      allowed: METHOD_ORDER.filter((name) => allowed.has(name)),
      pathMatched: allowed.size > 0,
    };
  }
}

function normalizePathname(pathname) {
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

module.exports = {
  HTTP_METHODS,
  METHOD_ORDER,
  Router,
  normalizePathname,
};
