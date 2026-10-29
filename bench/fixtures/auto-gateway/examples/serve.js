'use strict';

const { createGateway } = require('../src');
const health = require('../src/handlers/health');
const echo = require('../src/handlers/echo');
const profile = require('../src/handlers/profile');

const gateway = createGateway({ handlers: { 'GET /health': health, 'GET /echo': echo, 'GET /me': profile } });

console.log(gateway.handle({ method: 'GET', path: '/health' }));
console.log(gateway.handle({ method: 'GET', path: '/echo', query: { text: 'hello' } }));
console.log(gateway.handle({ method: 'GET', path: '/me', user: 'ana' }));
