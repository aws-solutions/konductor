const registry = new Map();
export function register(name, handler) { registry.set(name, handler); return handler; }
export function get(name) { return registry.get(name); }
export function names() { return [...registry.keys()]; }
