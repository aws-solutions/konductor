'use strict';

const http = require('node:http');
const { requestId } = require('./middleware/request-id');

function parseCookies(value = '') {
  return Object.fromEntries(value.split(';').map((part) => part.trim().split('=')));
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

function createServer(handler) {
  return http.createServer(async (request, response) => {
    const id = requestId(request);
    try {
      const body = await readBody(request);
      const result = await handler({
        method: request.method,
        path: new URL(request.url, 'http://localhost').pathname,
        headers: request.headers,
        cookies: parseCookies(request.headers.cookie),
        body
      });
      response.statusCode = result.status ?? 200;
      response.setHeader('x-request-id', id);
      if (result.cookies) {
        const options = result.cookieOptions ?? {};
        const headers = Object.entries(result.cookies).map(([name, value]) => cookieHeader(name, value, options[name] ?? { httpOnly: true, secure: true }));
        response.setHeader('set-cookie', headers);
      }
      if (result.clearCookies) {
        const expired = result.clearCookies.map((name) => cookieHeader(name, '', { maxAge: 0, httpOnly: true, secure: true }));
        response.setHeader('set-cookie', expired);
      }
      response.end(result.body === null ? '' : JSON.stringify(result.body));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: 'request failed', requestId: id }));
    }
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

module.exports = { createServer, cookieHeader, parseCookies };
