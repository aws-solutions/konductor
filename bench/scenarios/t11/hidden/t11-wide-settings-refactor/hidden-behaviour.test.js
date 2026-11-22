const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const callerTable = [{"module":"apps/billing/archive.js","args":[],"expected":{"enabled":true,"folder":"archive"},"call":["billing","archive.enabled",{"fallback":false}]},{"module":"apps/billing/currency.js","args":[],"expected":{"currency":"EUR","label":"EUR-ledger"},"call":["billing","currency",{"fallback":"USD"}]},{"module":"apps/billing/due-days.js","args":[],"expected":{"days":30,"label":"30-day"},"call":["billing","due.days",{"fallback":14}]},{"module":"apps/billing/email.js","args":[],"expected":{"from":"billing@harborline.test","domain":"harborline.test"},"call":["billing","email.from",{"fallback":""}]},{"module":"apps/billing/export.js","args":[],"expected":{"format":"csv","extension":".csv"},"call":["billing","export.format",{"fallback":"json"}]},{"module":"apps/billing/invoice-prefix.js","args":[],"expected":{"prefix":"INV-","sample":"INV-100"},"call":["billing","invoices.prefix",{"fallback":"INV-"}]},{"module":"apps/billing/ledger.js","args":[],"expected":{"path":"/ledger/v3","entries":"/ledger/v3/entries"},"call":["billing","ledger.path",{"fallback":"/ledger"}]},{"module":"apps/billing/page.js","args":[],"expected":{"size":100,"pagesFor200":2},"call":["billing","page.size",{"fallback":25}]},{"module":"apps/billing/precision.js","args":[],"expected":{"precision":2,"factor":100},"call":["billing","precision",{"fallback":2}]},{"module":"apps/billing/receipt.js","args":[],"expected":{"prefix":"R-","sample":"R-9"},"call":["billing","receipt.prefix",{"fallback":"R-"}]},{"module":"apps/billing/retries.js","args":[],"expected":{"retries":0,"attempts":1},"call":["billing","retries",{"fallback":0}]},{"module":"apps/billing/rounding.js","args":[],"expected":{"mode":"half-up","description":"round-half-up"},"call":["billing","rounding.mode",{"fallback":"half-up"}]},{"module":"apps/billing/tax.js","args":[],"expected":{"rate":0.2,"percent":20},"call":["billing","tax.rate",{"fallback":0}]},{"module":"apps/billing/timeout.js","args":[],"expected":{"timeout":1800,"seconds":1.8},"call":["billing","timeout",{"fallback":1200}]},{"module":"apps/dispatch/alert.js","args":[],"expected":{"enabled":true,"priority":1},"call":["dispatch","alert.enabled",{"fallback":false}]},{"module":"apps/dispatch/batch.js","args":[],"expected":{"size":80,"reserve":100},"call":["dispatch","batch.size",{"fallback":50}]},{"module":"apps/dispatch/callback.js","args":[],"expected":{"path":"/callbacks/dispatch","healthPath":"/callbacks/dispatch/status"},"call":["dispatch","callback.path",{"fallback":"/callbacks"}]},{"module":"apps/dispatch/carrier.js","args":[],"expected":{"code":"N6","slug":"n6"},"call":["dispatch","carrier.code",{"fallback":"XX"}]},{"module":"apps/dispatch/currency.js","args":[],"expected":{"currency":"USD","currencyTag":"usd"},"call":["dispatch","currency",{"fallback":"USD"}]},{"module":"apps/dispatch/cutoff.js","args":[],"expected":{"hour":19,"nextHour":20},"call":["dispatch","cutoff.hour",{"fallback":18}]},{"module":"apps/dispatch/labeler.js","args":[],"expected":{"prefix":"D-","sample":"D-001"},"call":["dispatch","labels.prefix",{"fallback":"D-"}]},{"module":"apps/dispatch/manifest.js","args":[],"expected":{"timeout":4500,"deadline":4800},"call":["dispatch","timeout",{"fallback":4500}]},{"module":"apps/dispatch/max-stops.js","args":[],"expected":{"maxStops":12,"routeLimit":36},"call":["dispatch","maxStops",{"fallback":8}]},{"module":"apps/dispatch/optional-header.js","args":[],"expected":{"header":"","wireValue":"plain"},"call":["dispatch","optionalHeader",{"fallback":""}]},{"module":"apps/dispatch/print.js","args":[],"expected":{"prefix":"Manifest-","example":"Manifest-2026"},"call":["dispatch","print.prefix",{"fallback":"Manifest-"}]},{"module":"apps/dispatch/region.js","args":[],"expected":{"region":"north","label":"NORTH"},"call":["dispatch","region",{"fallback":"south"}]},{"module":"apps/dispatch/retry-policy.js","args":[],"expected":{"retries":3,"budget":6},"call":["dispatch","retries",{"fallback":2}]},{"module":"apps/dispatch/route-planner.js","args":[],"expected":{"base":"/v1/routes","planningUrl":"/v1/routes/plan"},"call":["dispatch","routes.primary",{"fallback":"/fallback/routes"}]},{"module":"apps/dispatch/schedule.js","args":[],"expected":{"window":25,"grace":30},"call":["dispatch","schedule.window",{"fallback":15}]},{"module":"apps/dispatch/tls.js","args":[],"expected":{"required":true,"mode":"secure"},"call":["dispatch","tls.required",{"fallback":false}]},{"module":"apps/dispatch/webhook-timeout.js","args":[],"expected":{"timeout":1500,"seconds":1.5},"call":["dispatch","webhook.timeout",{"fallback":1000}]},{"module":"apps/dispatch/webhook.js","args":[],"expected":{"url":"https://hooks.fleet.test/dispatch","hostLength":33},"call":["dispatch","webhook.url",{"fallback":"https://hooks.invalid"}]},{"module":"apps/warehouse/aisle.js","args":[],"expected":{"aisle":"A-04","bin":"A-04-01"},"call":["warehouse","aisle.default",{"fallback":"A-01"}]},{"module":"apps/warehouse/bin.js","args":[],"expected":{"prefix":"BIN-","example":"BIN-0001"},"call":["warehouse","bin.prefix",{"fallback":"BIN-"}]},{"module":"apps/warehouse/capacity.js","args":[],"expected":{"capacity":640,"half":320},"call":["warehouse","capacity",{"fallback":400}]},{"module":"apps/warehouse/cold.js","args":[],"expected":{"maxCelsius":5,"warning":7},"call":["warehouse","cold.maxCelsius",{"fallback":4}]},{"module":"apps/warehouse/cycle.js","args":[],"expected":{"days":14,"weeks":2},"call":["warehouse","cycle.days",{"fallback":7}]},{"module":"apps/warehouse/handoff.js","args":[],"expected":{"delay":90,"minutes":1.5},"call":["warehouse","handoff.delay",{"fallback":60}]},{"module":"apps/warehouse/ingest.js","args":[],"expected":{"timeout":2200,"seconds":2.2},"call":["warehouse","timeout",{"fallback":2000}]},{"module":"apps/warehouse/label.js","args":[],"expected":{"prefix":"WH-","sample":"WH-A"},"call":["warehouse","labels.prefix",{"fallback":"WH-"}]},{"module":"apps/warehouse/manifest.js","args":[],"expected":{"version":"v2","label":"manifest-v2"},"call":["warehouse","manifest.version",{"fallback":"v1"}]},{"module":"apps/warehouse/overflow.js","args":[],"expected":{"enabled":false,"status":"closed"},"call":["warehouse","overflow.enabled",{"fallback":false}]},{"module":"apps/warehouse/packing.js","args":[],"expected":{"station":"P7","queue":"P7-queue"},"call":["warehouse","packing.station",{"fallback":"P1"}]},{"module":"apps/warehouse/reserve.js","args":[],"expected":{"percent":12.5,"available":87.5},"call":["warehouse","reserve.percent",{"fallback":10}]},{"module":"apps/warehouse/scanner.js","args":[],"expected":{"endpoint":"https://scanner.fleet.test/v2","health":"https://scanner.fleet.test/v2/health"},"call":["warehouse","scanner.endpoint",{"fallback":"https://scanner.invalid"}]},{"module":"apps/warehouse/strict.js","args":[],"expected":{"strict":false,"mode":"soft"},"call":["warehouse","strict",{"fallback":false}]},{"module":"apps/warehouse/timezone.js","args":[],"expected":{"timezone":"UTC","display":"UTC/depot"},"call":["warehouse","timezone",{"fallback":"UTC"}]},{"module":"apps/warehouse/zone.js","args":[],"expected":{"zone":"north-2","label":"north-2-dock"},"call":["warehouse","zones.primary",{"fallback":"south-1"}]},{"module":"jobs/cleanup.js","args":[],"expected":{"interval":3600,"minutes":60},"call":["jobs","cleanup.interval",{"fallback":1800}]},{"module":"jobs/dry-run.js","args":[],"expected":{"dryRun":false,"label":"live"},"call":["jobs","dryRun",{"fallback":false}]},{"module":"jobs/eu-queue.js","args":[],"expected":{"url":"https://queue-eu.fleet.test","health":"https://queue-eu.fleet.test/health"},"call":["queues","eu.url",{"fallback":"https://queue.invalid"}]},{"module":"jobs/eu-queue.js","args":["apac"],"expected":{"url":"https://queue.invalid","health":"https://queue.invalid/health"},"call":["queues","apac.url",{"fallback":"https://queue.invalid"}]},{"module":"jobs/heartbeat.js","args":[],"expected":{"interval":30,"seconds":60},"call":["jobs","heartbeat.interval",{"fallback":15}]},{"module":"jobs/nightly.js","args":[],"expected":{"hour":2,"label":"hour-2"},"call":["jobs","nightly.hour",{"fallback":1}]},{"module":"jobs/report.js","args":[],"expected":{"prefix":"night-","name":"night-daily"},"call":["jobs","report.prefix",{"fallback":"report-"}]},{"module":"jobs/retries.js","args":[],"expected":{"retries":4,"budget":12},"call":["jobs","retries",{"fallback":2}]},{"module":"jobs/us-queue.js","args":[],"expected":{"url":"https://queue-us.fleet.test","health":"https://queue-us.fleet.test/health"},"call":["queues","us.url",{"fallback":"https://queue.invalid"}]},{"module":"jobs/us-queue.js","args":["apac"],"expected":{"url":"https://queue.invalid","health":"https://queue.invalid/health"},"call":["queues","apac.url",{"fallback":"https://queue.invalid"}]},{"module":"lib/audit-prefix.js","args":[],"expected":{"prefix":"audit-","sample":"audit-log"},"call":["audit","file.prefix",{"fallback":"audit-"}]},{"module":"lib/audit-settings.js","args":[],"expected":{"enabled":true,"mode":"record"},"call":["audit","enabled",{"fallback":false}]},{"module":"lib/cache-settings.js","args":[],"expected":{"ttl":900,"minutes":15},"call":["runtime","cache.ttl",{"fallback":600}]},{"module":"lib/feature-settings.js","args":[],"expected":{"ledger":true,"state":"on"},"call":["features","ledger",{"fallback":false}]},{"module":"lib/request-timeout.js","args":[],"expected":{"timeout":1200,"seconds":1.2},"call":["runtime","request.timeout",{"fallback":900}]},{"module":"lib/runtime-host.js","args":[],"expected":{"host":"dispatch.internal","url":"https://dispatch.internal"},"call":["runtime","host",{"fallback":"localhost"}]}];
const callerPaths = [...new Set(callerTable.map((entry) => entry.module))];

function clearProjectCache() {
  const prefix = root + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key];
  }
}

test('every caller uses the split current reader and keeps its baseline result', () => {
  for (const entry of callerTable) {
    clearProjectCache();
    const config = require(path.join(root, 'lib/config.js'));
    const original = config.value;
    const calls = [];
    config.value = (...args) => {
      calls.push(args);
      return original(...args);
    };
    const caller = require(path.join(root, entry.module));
    assert.deepEqual(caller(...entry.args), entry.expected, entry.module);
    assert.deepEqual(calls, [entry.call], entry.module + ' reader call');
    config.value = original;
  }
});

test('the current reader preserves nested values, falsy values, and fallbacks', () => {
  const config = require(path.join(root, 'lib/config.js'));
  assert.equal(config.value('dispatch', 'routes.primary', { fallback: 'missing' }), '/v1/routes');
  assert.equal(config.value('dispatch', 'optionalHeader', { fallback: '' }), '');
  assert.equal(config.value('warehouse', 'strict', { fallback: false }), false);
  assert.equal(config.value('billing', 'tax.rate', { fallback: 99 }), 0.2);
  assert.equal(config.value('missing', 'setting', { fallback: 0 }), 0);
});

test('the package facade exports value and serviceTag without the retired reader', () => {
  const api = require(path.join(root, 'lib/index.js'));
  assert.equal(typeof api.value, 'function');
  assert.equal(api.read, undefined);
  assert.equal(api.serviceTag('health'), 'harborline:health');
});

test('the retired reader module is removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'lib/conf.js')), false);
});

test('queue callers keep the runtime region in the new key', () => {
  for (const name of ['eu-queue.js', 'us-queue.js']) {
    clearProjectCache();
    const config = require(path.join(root, 'lib/config.js'));
    const calls = [];
    config.value = (section, key, options) => {
      calls.push([section, key, options]);
      return 'https://' + key;
    };
    const caller = require(path.join(root, 'jobs', name));
    assert.deepEqual(caller('apac'), {
      url: 'https://apac.url',
      health: 'https://apac.url/health'
    });
    assert.deepEqual(calls, [['queues', 'apac.url', { fallback: 'https://queue.invalid' }]]);
  }
});

test('caller results respond to a changed reader value', () => {
  clearProjectCache();
  const config = require(path.join(root, 'lib/config.js'));
  config.value = () => 7000;
  assert.deepEqual(require(path.join(root, 'apps/dispatch/manifest.js'))(), {
    timeout: 7000,
    deadline: 7300
  });
});

test('README and configuration notes describe the current interface', () => {
  const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8') +
    fs.readFileSync(path.join(root, 'docs/config.md'), 'utf8');
  // The call may be written with quoted or bare placeholders, and with or without the config. prefix.
  assert.match(text, /(?:config\.)?value\s*\(\s*['"]?section['"]?,\s*['"]?key['"]?,\s*\{\s*fallback\s*\}\s*\)/);
  assert.doesNotMatch(text, /conf\.read|legacy|old reader/i);
});

test('all generated caller files contain a current reader call', () => {
  for (const relative of callerPaths) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(text, /\b(?:config\.)?value\s*\(/, relative); // config.value( or a destructured value(
  }
});

test('caller files do not retain a legacy reader dependency', () => {
  for (const relative of callerPaths) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(text, /\bconf\b|readSetting|\{ read \}/, relative);
  }
});

test('the package entry point has no retired module dependency', () => {
  const source = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/conf['"]\)/);
});
