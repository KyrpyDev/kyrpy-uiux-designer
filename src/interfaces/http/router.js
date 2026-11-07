/** Minimal router: patterns like /api/:types(icons|items)/:id/nodes. */
export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const names = [];
    const src = pattern.replace(/\/:(\w+)(?:\(([^)]+)\))?/g, (_, name, re) => { names.push(name); return `/(${re || '[^/]+'})`; });
    this.routes.push({ method, pattern, re: new RegExp(`^${src}$`), names, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /** Route table for docs: [{ method, pattern }] in registration order. */
  list() { return this.routes.map(({ method, pattern }) => ({ method, pattern })); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}
