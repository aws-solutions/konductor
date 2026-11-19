'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const targetPath = path.join(root, 'rules', 'checkout-api.json');
const expectedRunbook = 'https://ops.example.test/runbooks/checkout-latency-high';
const expectedOtherFileHashes = {
  ".github/workflows/ci.yml": "6a459335b703f4a046f8ea633c7d8d30bc70ab6370e2269c958c154042e9fd02",
  ".gitignore": "a155af4c6f43b3fb3e45faa397d3d015aec19090386f81b2886b3aa68a221ffa",
  ".nvmrc": "68ca3fba3b7e864770cb61aeb306d4bd4354b68ab4dd38450860c5d823e42a53",
  "CHANGELOG.md": "7e379b626330b83b1f096fb276e63b1d58601af7eddd6a78fb86e8a1c9670270",
  "README.md": "2d7ddca36d6477ddd2fd0241271d264313edfb0439aa8ebd74156bfc12d26e00",
  "config/environments.json": "a0dbe87e4ea3686a574bb80439f1978cf18db866ee9c7bc39450d8602f3ba18b",
  "config/owners.json": "26426442fd7d5a05c375201318052fc069f6746899f731a2ae3ef3d66edd3dc8",
  "data/deploy-history.jsonl": "d3b4c3e275ac6ab6ea50352cc62e86049fd9f7e9556b0aa44b80ce442157bcc6",
  "data/request-metrics.csv": "7fb044dcaece15508ac2b6090bbfe9788ff5c680dfbb468aa1efb0de85610b1f",
  "docs/alerting-style.md": "b768817f9ba424f9b5fb8e90577b94378d97c7a3d6a29773e3c68f85f9ab0336",
  "docs/rotation.md": "8ea577ed0145199121ac25dee663cc454b35bf5f338a07151498186dba624684",
  "docs/service-ownership.md": "2784414f4b35a6dbd4ae6104e405f9fc07414bd76e97f693fdc0348854915861",
  "logs/service-events.log": "62a31340380ee586120ee3bb42cc3787563ae808a6e0ec67421aa9030941eaab",
  "notes/2024-q4-alert-review.md": "b8867bcaba98cbfb86d552611218de334341d2402db19b4ead60c4185637d81e",
  "notes/archive/old-thresholds.md": "52dae09af27888e87ca4eae6577766538549aed110ebf5f442de37774ef52e00",
  "package.json": "d4a951058d205924cd01f570213f2df75200d563f072781e7b678c367c82eac9",
  "rules/catalog-api.json": "9908ed63c77fbda9c2cacc734825c3aa78e99dbb11c910d5133f1134c90dc686",
  "rules/identity-api.json": "b985b5e4b760178f3ade7599ccf59e7c9ba9c12e87e76662dcb13a6a53322264",
  "rules/notifications-worker.json": "f278a87a5944239160b6668ef98f32aceade67055632e59796a3afed56f9e33a",
  "rules/search-api.json": "73c6657f76c74deeb4547849fba8de42531ca6d788f5f79c684d197186a82d95",
  "runbooks/catalog-errors.md": "b27833b6d2106e487f93d0fe075ab2784a666f3a8524fde771028faac82b6666",
  "runbooks/queue-backlog.md": "5591dcb1250495c8f5aa6d5404086711c9d4ac01b8590458f91fd80ddbeaae4c",
  "runbooks/request-triage.md": "eb3a447604794fc9383b00bbc88a9e4e795b42abdb65af8c1c8e81d650612083",
  "scripts/check-drift.js": "dd6f2f8a2f4e93e8cc4d2b092c259521c54703a47fe81132b0e44074d4b77c7b",
  "scripts/render-summary.js": "a2d701e2f67d4672eadd9e5940186f1e1431396eb4cdaa1c1b248948b81314f7",
  "src/validate-rules.js": "0d7dfc04a6cbbc994936d46a4efd1b00d9a7c43f5ba60d413faf54c0e457a850",
  "test/fixtures/invalid-rule.json": "ffe5125945d896d0a2383239897942e1053b9cc22e7cea9816694dc7bcb7a595",
  "test/fixtures/valid-rule.json": "d5902b80cced3f5b8b7b058923c6a06a9df3a7c5ed4f495ef5da631fb2095133",
  "test/package.json": "e635900129716daea8cca181895dab78224edee70a831ade01494e41938ea9ad",
  "test/validator.test.js": "d50b5f937b370c2f5ef014b83e5ab1460f1e50e08ebd9b2661c90f82d339fd94"
};
const expectedDocument = {
  "service": "checkout-api",
  "owner": "payments-platform",
  "schemaVersion": 3,
  "rules": [
    {
      "name": "CheckoutLatencyHigh",
      "kind": "threshold",
      "metric": "http_request_duration_seconds_p95",
      "threshold": 1.2,
      "operator": ">",
      "duration": "15m",
      "labels": {
        "severity": "warning",
        "team": "checkout",
        "runbook": "https://ops.example.test/runbooks/checkout-latency-high"
      },
      "annotations": {
        "summary": "Checkout requests are taking longer than expected",
        "description": "The checkout p95 latency has exceeded the warning level."
      }
    },
    {
      "name": "CheckoutErrorRateHigh",
      "kind": "ratio",
      "metric": "http_requests_total",
      "threshold": 0.03,
      "operator": ">",
      "duration": "8m",
      "labels": {
        "severity": "critical",
        "team": "checkout"
      },
      "annotations": {
        "summary": "Checkout errors are elevated",
        "description": "The checkout error ratio needs attention."
      }
    },
    {
      "name": "CheckoutTrafficAbsent",
      "kind": "absence",
      "metric": "http_requests_total",
      "threshold": 0,
      "operator": "==",
      "duration": "12m",
      "labels": {
        "severity": "warning",
        "team": "checkout"
      },
      "annotations": {
        "summary": "Checkout traffic has stopped",
        "description": "No checkout requests have been observed in the evaluation window."
      }
    }
  ]
};

function readTarget() {
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function findTargetRule(document) {
  return document.rules.find((rule) => rule.name === 'CheckoutLatencyHigh');
}

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.relative(root, path.join(directory, entry.name));
    if (relative === 'hidden' || relative.startsWith(`hidden${path.sep}`) || entry.name === 'hidden-check.test.js') continue;
    if (entry.isDirectory()) found.push(...walk(path.join(directory, entry.name)));
    else found.push(relative.split(path.sep).join('/'));
  }
  return found;
}

test('checkout rules are JSON and contain the named alert', () => {
  const document = readTarget();
  assert.equal(document.service, 'checkout-api');
  assert.ok(findTargetRule(document));
});

test('CheckoutLatencyHigh uses the requested threshold', () => {
  assert.equal(findTargetRule(readTarget()).threshold, 1.2);
});

test('CheckoutLatencyHigh uses the requested duration', () => {
  assert.equal(findTargetRule(readTarget()).duration, '15m');
});

test('CheckoutLatencyHigh has the requested runbook label', () => {
  assert.equal(findTargetRule(readTarget()).labels.runbook, expectedRunbook);
});

test('the edit changes only the requested rule fields and no other file', () => {
  assert.deepStrictEqual(readTarget(), expectedDocument);
  const expectedPaths = Object.keys(expectedOtherFileHashes).sort();
  const actualPaths = walk(root).filter((file) => file !== 'rules/checkout-api.json').sort();
  assert.deepStrictEqual(actualPaths, expectedPaths);
  for (const relative of expectedPaths) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert.equal(actual, expectedOtherFileHashes[relative], `${relative} changed`);
  }
});

test('the validator passes with the updated checkout alert', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'src', 'validate-rules.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rule = findTargetRule(readTarget());
  assert.deepStrictEqual({ threshold: rule.threshold, duration: rule.duration, runbook: rule.labels.runbook }, {
    threshold: 1.2,
    duration: '15m',
    runbook: expectedRunbook,
  });
});
