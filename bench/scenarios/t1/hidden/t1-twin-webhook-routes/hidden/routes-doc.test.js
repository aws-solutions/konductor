'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'ROUTES.md');
const ROUTER_PATH = path.join(ROOT, 'src', 'router.js');

function readDoc() {
  assert.ok(fs.existsSync(DOC_PATH), 'docs/ROUTES.md must exist');
  return fs.readFileSync(DOC_PATH, 'utf8');
}

function tableRows(document) {
  const lines = document.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const cells = line.split('|').map((cell) => cell.trim().toLowerCase());
    return cells.includes('method') && cells.includes('path') &&
      cells.includes('handler file') && cells.includes('purpose');
  });
  assert.notEqual(headerIndex, -1, 'ROUTES.md must have the required table headers');

  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s*\|/.test(line)) break;
    if (/^\s*\|\s*:?-{3,}/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (cells.length >= 4) {
      rows.push({
        method: cells[0].replace(/^`|`$/g, ''),
        path: cells[1].replace(/^`|`$/g, ''),
        handler: cells[2].replace(/^`|`$/g, ''),
        purpose: cells[3],
      });
    }
  }
  return rows;
}

function registeredRoutes() {
  const source = fs.readFileSync(ROUTER_PATH, 'utf8');
  return [...source.matchAll(/req\.method\s*===\s*'([^']+)'\s*&&\s*req\.url\s*===\s*'([^']+)'/g)]
    .map((match) => ({ method: match[1], path: match[2] }));
}

function registeredHandlers() {
  const source = fs.readFileSync(ROUTER_PATH, 'utf8');
  const imports = Object.fromEntries([...source.matchAll(
    /const\s+\{\s*([A-Za-z0-9_]+)\s*\}\s*=\s*require\('\.\/handlers\/([^']+)'\)/g,
  )].map((match) => [match[1], `src/handlers/${match[2]}.js`]));
  return [...source.matchAll(
    /if\s*\(\s*req\.method\s*===\s*'([^']+)'\s*&&\s*req\.url\s*===\s*'([^']+)'\s*\)\s*(?:\{\s*)?return\s+([A-Za-z0-9_]+)\s*\(/g,
  )].map((match) => ({
    method: match[1],
    path: match[2],
    handler: imports[match[3]],
  }));
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

test('ROUTES.md exists and has the required route table', () => {
  const rows = tableRows(readDoc());
  assert.ok(rows.length > 0);
});

test('the table lists exactly the routes registered by the service', () => {
  const actual = registeredRoutes().map(routeKey).sort();
  const documented = tableRows(readDoc()).map(routeKey).sort();
  assert.deepEqual(documented, actual);
});

test('the table has no duplicate route rows', () => {
  const rows = tableRows(readDoc());
  const keys = rows.map(routeKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(rows.length, registeredRoutes().length);
});

test('each documented route uses the registered handler file', () => {
  const expected = registeredHandlers().map((route) => ({
    method: route.method,
    path: route.path,
    handler: route.handler,
  })).sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
  const documented = tableRows(readDoc()).map((route) => ({
    method: route.method,
    path: route.path,
    handler: route.handler,
  })).sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
  assert.deepEqual(documented, expected);
});

test('every handler file named in the table exists', () => {
  for (const row of tableRows(readDoc())) {
    assert.ok(fs.existsSync(path.join(ROOT, row.handler)), row.handler);
  }
});

test('every route row has a one-line purpose', () => {
  for (const row of tableRows(readDoc())) {
    assert.match(row.purpose, /\S/);
    assert.doesNotMatch(row.purpose, /\|/);
  }
});

test('the table uses HTTP methods and absolute paths', () => {
  for (const row of tableRows(readDoc())) {
    assert.match(row.method, /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/);
    assert.match(row.path, /^\//);
  }
});

test('a sentence identifies the provider webhook route', () => {
  // The prompt asks for a sentence naming the route; it does not fix the wording.
  const prose = readDoc().split(/\r?\n/).filter((line) => !/^\s*\|/.test(line));
  assert.ok(prose.some((line) => /webhook/i.test(line) && /POST\W+\/webhooks\/payment/.test(line)),
    'a line outside the table must name POST /webhooks/payment as the webhook route');
});
