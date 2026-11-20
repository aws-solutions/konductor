'use strict';
const registry = new Map();
function register(name, handler) { registry.set(name, handler); return handler; }
function get(name) { return registry.get(name); }
function names() { return [...registry.keys()]; }
module.exports = { register, get, names };
