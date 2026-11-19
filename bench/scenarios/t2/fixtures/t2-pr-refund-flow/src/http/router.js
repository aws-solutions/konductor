export function route(method, pattern, handler) {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}$`);
  return { method, regex, names, handler };
}

export function match(routes, method, pathname) {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = pathname.match(candidate.regex);
    if (found) return { candidate, params: Object.fromEntries(candidate.names.map((n, i) => [n, found[i + 1]])) };
  }
  return null;
}
