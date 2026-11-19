class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), parts, handler });
  }

  match(method, pathname) {
    const wanted = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase() || route.parts.length !== wanted.length) continue;
      const params = {};
      let matched = true;
      route.parts.forEach((part, index) => {
        if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(wanted[index]);
        else if (part !== wanted[index]) matched = false;
      });
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

module.exports = { Router };
