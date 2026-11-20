'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'fixture');

function write(relative, contents) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

const staticFiles = {
  'package.json': `{
  "name": "harborline-dispatch",
  "version": "3.8.1",
  "private": true,
  "description": "Back-office tools for Harborline freight operations",
  "main": "lib/index.js",
  "engines": { "node": ">=24" },
  "scripts": { "test": "node --test test/*.test.js" }
}
`,
  'README.md': `# Harborline back office

Harborline coordinates dock appointments, warehouse handoffs, and carrier billing.
The service currently reads settings with the legacy \`conf.read('section.key', fallback)\` helper.
Configuration lives in \`config/app.json\`; operators edit that file during a release window.

The three application areas share small CommonJS modules. A module returns the settings it needs and a derived value used by its caller. Keep the returned object plain so the nightly reconciliation job can serialize it.

Useful commands:

- \`npm test\` runs the local checks.
- \`node bin/report-health.js\` prints a short status line.
`,
  'CHANGELOG.md': `# Changelog

## 3.8.1 - 2026-04-18

- Added a second cold-storage lane to the North depot.
- Recorded queue latency in the nightly operations report.
- Clarified the release note for the configuration reader.

## 3.8.0 - 2026-03-02

- Added invoice archive settings.
- Raised the default warehouse scan window.
`,
  'config/app.json': `{
  "dispatch": {
    "timeout": 4500,
    "routes": { "primary": "/v1/routes" },
    "labels": { "prefix": "D-" },
    "retries": 3,
    "webhook": { "url": "https://hooks.fleet.test/dispatch", "timeout": 1500 },
    "cutoff": { "hour": 19 },
    "tls": { "required": true },
    "region": "north",
    "batch": { "size": 80 },
    "callback": { "path": "/callbacks/dispatch" },
    "carrier": { "code": "N6" },
    "maxStops": 12,
    "alert": { "enabled": true },
    "currency": "USD",
    "schedule": { "window": 25 },
    "print": { "prefix": "Manifest-" }
  },
  "warehouse": {
    "timeout": 2200,
    "zones": { "primary": "north-2" },
    "labels": { "prefix": "WH-" },
    "capacity": 640,
    "scanner": { "endpoint": "https://scanner.fleet.test/v2" },
    "aisle": { "default": "A-04" },
    "cold": { "maxCelsius": 5 },
    "cycle": { "days": 14 },
    "packing": { "station": "P7" },
    "manifest": { "version": "v2" },
    "bin": { "prefix": "BIN-" },
    "handoff": { "delay": 90 },
    "timezone": "UTC",
    "reserve": { "percent": 12.5 }
  },
  "queues": {
    "eu": { "url": "https://queue-eu.fleet.test" },
    "us": { "url": "https://queue-us.fleet.test" }
  },
  "jobs": {
    "nightly": { "hour": 2 },
    "cleanup": { "interval": 3600 },
    "retries": 4,
    "report": { "prefix": "night-" },
    "heartbeat": { "interval": 30 }
  },
  "billing": {
    "currency": "EUR",
    "invoices": { "prefix": "INV-" },
    "tax": { "rate": 0.2 },
    "timeout": 1800,
    "ledger": { "path": "/ledger/v3" },
    "rounding": { "mode": "half-up" },
    "export": { "format": "csv" },
    "page": { "size": 100 },
    "receipt": { "prefix": "R-" },
    "due": { "days": 30 },
    "email": { "from": "billing@harborline.test" },
    "archive": { "enabled": true },
    "precision": 2
  },
  "runtime": {
    "cache": { "ttl": 900 },
    "host": "dispatch.internal",
    "request": { "timeout": 1200 }
  },
  "audit": { "enabled": true, "file": { "prefix": "audit-" } },
  "features": { "ledger": true }
}
`,
  '.github/workflows/ci.yml': `name: harborline-ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm test
`,
  'docs/config.md': `# Configuration notes

Settings are kept in \`config/app.json\` and are grouped by the service area that owns them. The old \`conf.read\` reader accepts a dotted setting name and a fallback value.

Use a short-lived branch for an operational setting change. Check the dispatch timeout and warehouse scan endpoint together because the two systems share the same appointment window.

The queue URLs are selected by region. Billing uses a separate currency and invoice prefix so a warehouse-only change does not alter customer documents.
`,
  'docs/operations.md': `# Operations card

The morning handoff starts at 05:30 local depot time. The nightly report is written before the first carrier manifest is printed. If a scanner is offline, the warehouse team records the aisle on paper and enters it after the endpoint returns.

The release checklist still calls the setting helper the old reader. That wording is retained here because several shift notes use it when comparing a release to the previous one.
`,
  'data/routes.json': `[
  { "code": "N6", "name": "North loop", "stops": 18 },
  { "code": "S2", "name": "South loop", "stops": 11 },
  { "code": "E4", "name": "East loop", "stops": 9 }
]
`,
  'third_party/tiny-settings/index.js': `'use strict';

module.exports = {
  read(name, fallback) {
    if (name === 'vendor.mode') return 'sealed';
    return fallback;
  }
};
`,
};

const moduleRows = [];
function addGroup(dir, requirePath, rows) {
  for (const row of rows) moduleRows.push({ dir, requirePath, ...row });
}

// The rows are the fixture's source table. Each one becomes one small caller module.
addGroup('apps/dispatch', '../../lib/conf', [
  { file: 'manifest.js', fn: 'buildDispatchManifest', key: 'dispatch.timeout', field: 'timeout', fallback: 4500, style: 'direct', logic: ['deadline', 'timeout + 300'] },
  { file: 'route-planner.js', fn: 'buildRoutePlanner', key: 'dispatch.routes.primary', field: 'base', fallback: '/fallback/routes', style: 'alias', logic: ['planningUrl', "base + '/plan'"] },
  { file: 'labeler.js', fn: 'buildDispatchLabeler', key: 'dispatch.labels.prefix', field: 'prefix', fallback: 'D-', style: 'destruct', logic: ['sample', "prefix + '001'"] },
  { file: 'retry-policy.js', fn: 'buildRetryPolicy', key: 'dispatch.retries', field: 'retries', fallback: 2, style: 'direct', logic: ['budget', 'retries * 2'] },
  { file: 'webhook.js', fn: 'buildDispatchWebhook', key: 'dispatch.webhook.url', field: 'url', fallback: 'https://hooks.invalid', style: 'alias', logic: ['hostLength', 'url.length'] },
  { file: 'webhook-timeout.js', fn: 'buildWebhookTimeout', key: 'dispatch.webhook.timeout', field: 'timeout', fallback: 1000, style: 'direct', logic: ['seconds', 'timeout / 1000'] },
  { file: 'cutoff.js', fn: 'buildDispatchCutoff', key: 'dispatch.cutoff.hour', field: 'hour', fallback: 18, style: 'destruct', logic: ['nextHour', 'hour + 1'] },
  { file: 'optional-header.js', fn: 'buildOptionalHeader', key: 'dispatch.optionalHeader', field: 'header', fallback: '', style: 'direct', logic: ['wireValue', "header || 'plain'"] },
  { file: 'tls.js', fn: 'buildDispatchTls', key: 'dispatch.tls.required', field: 'required', fallback: false, style: 'direct', logic: ['mode', "required ? 'secure' : 'plain'"] },
  { file: 'region.js', fn: 'buildDispatchRegion', key: 'dispatch.region', field: 'region', fallback: 'south', style: 'alias', logic: ['label', 'region.toUpperCase()'] },
  { file: 'batch.js', fn: 'buildDispatchBatch', key: 'dispatch.batch.size', field: 'size', fallback: 50, style: 'direct', logic: ['reserve', 'size + 20'] },
  { file: 'callback.js', fn: 'buildDispatchCallback', key: 'dispatch.callback.path', field: 'path', fallback: '/callbacks', style: 'destruct', logic: ['healthPath', "path + '/status'"] },
  { file: 'carrier.js', fn: 'buildDispatchCarrier', key: 'dispatch.carrier.code', field: 'code', fallback: 'XX', style: 'alias', logic: ['slug', 'code.toLowerCase()'] },
  { file: 'max-stops.js', fn: 'buildDispatchStops', key: 'dispatch.maxStops', field: 'maxStops', fallback: 8, style: 'direct', logic: ['routeLimit', 'maxStops * 3'] },
  { file: 'alert.js', fn: 'buildDispatchAlert', key: 'dispatch.alert.enabled', field: 'enabled', fallback: false, style: 'destruct', logic: ['priority', 'enabled ? 1 : 0'] },
  { file: 'currency.js', fn: 'buildDispatchCurrency', key: 'dispatch.currency', field: 'currency', fallback: 'USD', style: 'index', logic: ['currencyTag', 'currency.toLowerCase()'] },
  { file: 'schedule.js', fn: 'buildDispatchSchedule', key: 'dispatch.schedule.window', field: 'window', fallback: 15, style: 'direct', logic: ['grace', 'window + 5'] },
  { file: 'print.js', fn: 'buildDispatchPrint', key: 'dispatch.print.prefix', field: 'prefix', fallback: 'Manifest-', style: 'index', logic: ['example', "prefix + '2026'"] },
]);

addGroup('apps/warehouse', '../../lib/conf', [
  { file: 'ingest.js', fn: 'buildWarehouseIngest', key: 'warehouse.timeout', field: 'timeout', fallback: 2000, style: 'direct', logic: ['seconds', 'timeout / 1000'] },
  { file: 'zone.js', fn: 'buildWarehouseZone', key: 'warehouse.zones.primary', field: 'zone', fallback: 'south-1', style: 'direct', logic: ['label', "zone + '-dock'"] },
  { file: 'label.js', fn: 'buildWarehouseLabel', key: 'warehouse.labels.prefix', field: 'prefix', fallback: 'WH-', style: 'alias', logic: ['sample', "prefix + 'A'"] },
  { file: 'capacity.js', fn: 'buildWarehouseCapacity', key: 'warehouse.capacity', field: 'capacity', fallback: 400, style: 'destruct', logic: ['half', 'capacity / 2'] },
  { file: 'strict.js', fn: 'buildWarehouseStrict', key: 'warehouse.strict', field: 'strict', fallback: false, style: 'index', logic: ['mode', "strict ? 'hard' : 'soft'"] },
  { file: 'scanner.js', fn: 'buildWarehouseScanner', key: 'warehouse.scanner.endpoint', field: 'endpoint', fallback: 'https://scanner.invalid', style: 'direct', logic: ['health', "endpoint + '/health'"] },
  { file: 'aisle.js', fn: 'buildWarehouseAisle', key: 'warehouse.aisle.default', field: 'aisle', fallback: 'A-01', style: 'alias', logic: ['bin', "aisle + '-01'"] },
  { file: 'cold.js', fn: 'buildWarehouseCold', key: 'warehouse.cold.maxCelsius', field: 'maxCelsius', fallback: 4, style: 'destruct', logic: ['warning', 'maxCelsius + 2'] },
  { file: 'cycle.js', fn: 'buildWarehouseCycle', key: 'warehouse.cycle.days', field: 'days', fallback: 7, style: 'direct', logic: ['weeks', 'days / 7'] },
  { file: 'packing.js', fn: 'buildWarehousePacking', key: 'warehouse.packing.station', field: 'station', fallback: 'P1', style: 'index', logic: ['queue', "station + '-queue'"] },
  { file: 'manifest.js', fn: 'buildWarehouseManifest', key: 'warehouse.manifest.version', field: 'version', fallback: 'v1', style: 'direct', logic: ['label', "'manifest-' + version"] },
  { file: 'overflow.js', fn: 'buildWarehouseOverflow', key: 'warehouse.overflow.enabled', field: 'enabled', fallback: false, style: 'alias', logic: ['status', "enabled ? 'open' : 'closed'"] },
  { file: 'bin.js', fn: 'buildWarehouseBin', key: 'warehouse.bin.prefix', field: 'prefix', fallback: 'BIN-', style: 'index', logic: ['example', "prefix + '0001'"] },
  { file: 'handoff.js', fn: 'buildWarehouseHandoff', key: 'warehouse.handoff.delay', field: 'delay', fallback: 60, style: 'direct', logic: ['minutes', 'delay / 60'] },
  { file: 'timezone.js', fn: 'buildWarehouseTimezone', key: 'warehouse.timezone', field: 'timezone', fallback: 'UTC', style: 'alias', logic: ['display', "timezone + '/depot'"] },
  { file: 'reserve.js', fn: 'buildWarehouseReserve', key: 'warehouse.reserve.percent', field: 'percent', fallback: 10, style: 'destruct', logic: ['available', '100 - percent'] },
]);

addGroup('apps/billing', '../../lib/conf', [
  { file: 'currency.js', fn: 'buildBillingCurrency', key: 'billing.currency', field: 'currency', fallback: 'USD', style: 'direct', logic: ['label', "currency + '-ledger'"] },
  { file: 'invoice-prefix.js', fn: 'buildInvoicePrefix', key: 'billing.invoices.prefix', field: 'prefix', fallback: 'INV-', style: 'alias', logic: ['sample', "prefix + '100'"] },
  { file: 'tax.js', fn: 'buildBillingTax', key: 'billing.tax.rate', field: 'rate', fallback: 0, style: 'destruct', logic: ['percent', 'rate * 100'] },
  { file: 'timeout.js', fn: 'buildBillingTimeout', key: 'billing.timeout', field: 'timeout', fallback: 1200, style: 'direct', logic: ['seconds', 'timeout / 1000'] },
  { file: 'ledger.js', fn: 'buildBillingLedger', key: 'billing.ledger.path', field: 'path', fallback: '/ledger', style: 'index', logic: ['entries', "path + '/entries'"] },
  { file: 'rounding.js', fn: 'buildBillingRounding', key: 'billing.rounding.mode', field: 'mode', fallback: 'half-up', style: 'alias', logic: ['description', "'round-' + mode"] },
  { file: 'export.js', fn: 'buildBillingExport', key: 'billing.export.format', field: 'format', fallback: 'json', style: 'direct', logic: ['extension', "'.' + format"] },
  { file: 'page.js', fn: 'buildBillingPage', key: 'billing.page.size', field: 'size', fallback: 25, style: 'destruct', logic: ['pagesFor200', '200 / size'] },
  { file: 'receipt.js', fn: 'buildBillingReceipt', key: 'billing.receipt.prefix', field: 'prefix', fallback: 'R-', style: 'index', logic: ['sample', "prefix + '9'"] },
  { file: 'due-days.js', fn: 'buildBillingDueDays', key: 'billing.due.days', field: 'days', fallback: 14, style: 'direct', logic: ['label', "days + '-day'"] },
  { file: 'retries.js', fn: 'buildBillingRetries', key: 'billing.retries', field: 'retries', fallback: 0, style: 'alias', logic: ['attempts', 'retries + 1'] },
  { file: 'email.js', fn: 'buildBillingEmail', key: 'billing.email.from', field: 'from', fallback: '', style: 'destruct', logic: ['domain', "from.split('@')[1] || 'none'"] },
  { file: 'archive.js', fn: 'buildBillingArchive', key: 'billing.archive.enabled', field: 'enabled', fallback: false, style: 'direct', logic: ['folder', "enabled ? 'archive' : 'live'"] },
  { file: 'precision.js', fn: 'buildBillingPrecision', key: 'billing.precision', field: 'precision', fallback: 2, style: 'index', logic: ['factor', '10 ** precision'] },
]);

addGroup('jobs', '../lib/conf', [
  { file: 'nightly.js', fn: 'buildNightlyJob', key: 'jobs.nightly.hour', field: 'hour', fallback: 1, style: 'direct', logic: ['label', "'hour-' + hour"] },
  { file: 'cleanup.js', fn: 'buildCleanupJob', key: 'jobs.cleanup.interval', field: 'interval', fallback: 1800, style: 'alias', logic: ['minutes', 'interval / 60'] },
  { file: 'eu-queue.js', fn: 'buildEuQueue', dynamic: { arg: 'region', default: 'eu', section: 'queues', keyExpr: '`${region}.url`', pathExpr: '`queues.${region}.url`' }, field: 'url', fallback: 'https://queue.invalid', style: 'index', logic: ['health', "url + '/health'"] },
  { file: 'us-queue.js', fn: 'buildUsQueue', dynamic: { arg: 'region', default: 'us', section: 'queues', keyExpr: 'region + ".url"', pathExpr: "'queues.' + region + '.url'" }, field: 'url', fallback: 'https://queue.invalid', style: 'direct', logic: ['health', "url + '/health'"] },
  { file: 'retries.js', fn: 'buildJobRetries', key: 'jobs.retries', field: 'retries', fallback: 2, style: 'direct', logic: ['budget', 'retries * 3'] },
  { file: 'report.js', fn: 'buildJobReport', key: 'jobs.report.prefix', field: 'prefix', fallback: 'report-', style: 'destruct', logic: ['name', "prefix + 'daily'"] },
  { file: 'dry-run.js', fn: 'buildDryRun', key: 'jobs.dryRun', field: 'dryRun', fallback: false, style: 'alias', logic: ['label', "dryRun ? 'preview' : 'live'"] },
  { file: 'heartbeat.js', fn: 'buildHeartbeat', key: 'jobs.heartbeat.interval', field: 'interval', fallback: 15, style: 'index', logic: ['seconds', 'interval * 2'] },
]);

addGroup('lib', './conf', [
  { file: 'cache-settings.js', fn: 'buildCacheSettings', key: 'runtime.cache.ttl', field: 'ttl', fallback: 600, style: 'direct', logic: ['minutes', 'ttl / 60'] },
  { file: 'runtime-host.js', fn: 'buildRuntimeHost', key: 'runtime.host', field: 'host', fallback: 'localhost', style: 'alias', logic: ['url', "'https://' + host"] },
  { file: 'audit-settings.js', fn: 'buildAuditSettings', key: 'audit.enabled', field: 'enabled', fallback: false, style: 'destruct', logic: ['mode', "enabled ? 'record' : 'skip'"] },
  { file: 'audit-prefix.js', fn: 'buildAuditPrefix', key: 'audit.file.prefix', field: 'prefix', fallback: 'audit-', style: 'index', logic: ['sample', "prefix + 'log'"] },
  { file: 'feature-settings.js', fn: 'buildFeatureSettings', key: 'features.ledger', field: 'ledger', fallback: false, style: 'direct', logic: ['state', "ledger ? 'on' : 'off'"] },
  { file: 'request-timeout.js', fn: 'buildRequestTimeout', key: 'runtime.request.timeout', field: 'timeout', fallback: 900, style: 'index', logic: ['seconds', 'timeout / 1000'] },
]);

function literal(value) {
  return JSON.stringify(value);
}

function importLines(entry) {
  if (entry.style === 'direct') return [`const conf = require('${entry.requirePath}');`];
  if (entry.style === 'alias') return [`const readSetting = require('${entry.requirePath}').read;`];
  if (entry.style === 'destruct') return [`const { read } = require('${entry.requirePath}');`];
  if (entry.style === 'index') {
    const indexPath = entry.requirePath === './conf' ? './index' : entry.requirePath === '../lib/conf' ? '../lib' : '../../lib';
    return [`const { read } = require('${indexPath}');`];
  }
  return [];
}

function readLines(entry) {
  const reader = entry.style === 'direct' ? 'conf.read' : entry.style === 'alias' ? 'readSetting' : 'read';
  if (entry.dynamic) {
    return [
      `  const settingPath = ${entry.dynamic.pathExpr};`,
      `  const ${entry.field} = ${reader}(settingPath, ${literal(entry.fallback)});`,
    ];
  }
  return [`  const ${entry.field} = ${reader}(${literal(entry.key)}, ${literal(entry.fallback)});`];
}

function moduleSource(entry) {
  const args = entry.dynamic ? '' : '';
  const params = entry.dynamic ? entry.dynamic.arg + ` = ${literal(entry.dynamic.default)}` : args;
  const lines = ["'use strict';", '', ...importLines(entry), '', `module.exports = function ${entry.fn}(${params}) {`, ...readLines(entry), `  const ${entry.logic[0]} = ${entry.logic[1]};`, `  return { ${entry.field}, ${entry.logic[0]} };`, '};', ''];
  return lines.join('\n');
}

for (const file of Object.keys(staticFiles)) write(file, staticFiles[file]);

write('lib/conf.js', `'use strict';

const fs = require('node:fs');
const path = require('node:path');
const values = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8'));

function read(name, fallback) {
  const parts = name.split('.');
  const section = parts.shift();
  let current = values[section];
  for (const part of parts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

module.exports = { read };
`);

write('lib/config.js', `'use strict';

const fs = require('node:fs');
const path = require('node:path');
const values = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8'));

/**
 * Read a setting from app.json. The first dotted part is the section; all
 * remaining dotted parts form the key, so a.b.c means section a and key b.c.
 * A fallback is used only when the resolved value is undefined.
 */
function value(section, key, { fallback } = {}) {
  let current = values[section];
  for (const part of key.split('.')) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

module.exports = { value };
`);

write('lib/index.js', `'use strict';

const { read } = require('./conf');
const { value } = require('./config');

module.exports = {
  read,
  value,
  serviceTag(name) {
    return 'harborline:' + name;
  }
};
`);

for (const entry of moduleRows) write(path.join(entry.dir, entry.file), moduleSource(entry));

const tests = {
  'test/config.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');

test('new config reader returns nested values and preserves falsy values', () => {
  assert.equal(config.value('dispatch', 'timeout', { fallback: 0 }), 4500);
  assert.equal(config.value('dispatch', 'optionalHeader', { fallback: '' }), '');
  assert.equal(config.value('warehouse', 'strict', { fallback: false }), false);
  assert.equal(config.value('billing', 'retries', { fallback: 0 }), 0);
  assert.equal(config.value('warehouse', 'labels.prefix', { fallback: 'x' }), 'WH-');
});
`,
  'test/dispatch.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../apps/dispatch/manifest');
const labeler = require('../apps/dispatch/labeler');
const header = require('../apps/dispatch/optional-header');

test('dispatch modules expose settings and derived values', () => {
  assert.deepEqual(manifest(), { timeout: 4500, deadline: 4800 });
  assert.deepEqual(labeler(), { prefix: 'D-', sample: 'D-001' });
  assert.deepEqual(header(), { header: '', wireValue: 'plain' });
});
`,
  'test/warehouse.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const zone = require('../apps/warehouse/zone');
const strict = require('../apps/warehouse/strict');

test('warehouse modules keep their operational defaults', () => {
  assert.deepEqual(zone(), { zone: 'north-2', label: 'north-2-dock' });
  assert.deepEqual(strict(), { strict: false, mode: 'soft' });
});
`,
  'test/billing.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const tax = require('../apps/billing/tax');
const retries = require('../apps/billing/retries');

test('billing modules calculate invoice values', () => {
  assert.deepEqual(tax(), { rate: 0.2, percent: 20 });
  assert.deepEqual(retries(), { retries: 0, attempts: 1 });
});
`,
  'test/jobs.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const euQueue = require('../jobs/eu-queue');
const usQueue = require('../jobs/us-queue');

test('queue jobs keep the region in the setting key', () => {
  assert.deepEqual(euQueue(), { url: 'https://queue-eu.fleet.test', health: 'https://queue-eu.fleet.test/health' });
  assert.deepEqual(usQueue(), { url: 'https://queue-us.fleet.test', health: 'https://queue-us.fleet.test/health' });
});
`,
  'test/index.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../lib');

test('the shared index exposes the current reader and service tags', () => {
  assert.equal(api.value('dispatch', 'currency', { fallback: 'GBP' }), 'USD');
  assert.equal(api.serviceTag('billing'), 'harborline:billing');
});
`,
  'test/vendor.test.js': `const test = require('node:test');
const assert = require('node:assert/strict');
const vendor = require('../third_party/tiny-settings');

test('the vendored setting helper remains independent', () => {
  assert.equal(vendor.read('vendor.mode', 'open'), 'sealed');
  assert.equal(vendor.read('unknown', 'open'), 'open');
});
`,
};
for (const file of Object.keys(tests)) write(file, tests[file]);

write('bin/report-health.js', `#!/usr/bin/env node
'use strict';

const { serviceTag } = require('../lib');
const { timeout } = require('../apps/dispatch/manifest')();
console.log(serviceTag('dispatch') + ' timeout=' + timeout);
`);

console.log(`wrote ${moduleRows.length} caller modules and ${Object.keys(staticFiles).length + Object.keys(tests).length + 4} supporting files`);
