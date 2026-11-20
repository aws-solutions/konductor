'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadEnvironment } = require('./scripts/render-config.js');

const answerPath = path.join(__dirname, 'answers', 'prod-debug.json');

function readAnswer() {
  return JSON.parse(fs.readFileSync(answerPath, 'utf8'));
}

// The shape tests count only for an answer that names the right services: a list of the wrong services in the right
// shape is not half an answer.
function rightServices() {
  const want = loadEnvironment('production').filter((s) => s.logLevel === 'debug').map((s) => s.service).sort();
  const got = readAnswer().map((record) => record.service).sort();
  assert.deepEqual(got, want, 'the answer must name exactly the services whose rendered production logLevel is debug');
}

test('the answer is a JSON list', () => {
  rightServices();
  const answer = readAnswer();
  assert.equal(Array.isArray(answer), true);
});

test('the answer lists every effective production debug service', () => {
  const expected = loadEnvironment('production')
    .filter((service) => service.logLevel === 'debug')
    .map((service) => ({ service: service.service, replicas: service.replicas }))
    .sort((left, right) => left.service.localeCompare(right.service));
  assert.deepEqual(readAnswer(), expected);
});

test('answer records are sorted by service name', () => {
  rightServices();
  const names = readAnswer().map((record) => record.service);
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right)));
});

test('answer records contain only the requested fields', () => {
  rightServices();
  for (const record of readAnswer()) {
    assert.deepEqual(Object.keys(record).sort(), ['replicas', 'service']);
  }
});

test('answer services are unique and replica counts are positive integers', () => {
  rightServices();
  const answer = readAnswer();
  assert.equal(new Set(answer.map((record) => record.service)).size, answer.length);
  for (const record of answer) {
    assert.equal(typeof record.service, 'string');
    assert.equal(Number.isInteger(record.replicas), true);
    assert.ok(record.replicas > 0);
  }
});

test('each listed service uses its effective rendered replica count', () => {
  rightServices();
  const effective = new Map(loadEnvironment('production').map((service) => [service.service, service]));
  for (const record of readAnswer()) {
    assert.equal(effective.get(record.service).logLevel, 'debug');
    assert.equal(record.replicas, effective.get(record.service).replicas);
  }
});

const EXPECTED_FILES = {
  ".github/workflows/ci.yml": "b095d528b054b2e2a91ae5f504d41c970a97683c177114e4cb187538114d686a",
  "CHANGELOG.md": "3f3d94e2a11fc95fa4a379ba4760399283f0b38cfc68a847e03df8af47db5aa3",
  "README.md": "52840e388be94ae2a2723f8630ef9ad728c543cf6c24690eaaa4502f3dde2c35",
  "config/development/api-gateway.json": "0cf8023b917c275f546cee2864bdbffd52556e6d0382229af89c196b3d94fcb1",
  "config/development/billing-worker.json": "a7020d28cb25a8b426f746aee37a3c880d8a52976b09eb38c008eda4df8ef41e",
  "config/development/catalog.json": "564edaea0d84805304210fcf26f8a33113d5583e7cdbf5015cbf9257b2f20ebe",
  "config/development/email-dispatch.json": "0eca1c92c971157011540356a164bce162ca7572dbe29238157e8995985d3e49",
  "config/development/inventory.json": "525011e570f8776c08aba5d6c4df24cf45ac81677d880122ac6182dbf1e30e25",
  "config/development/media-proxy.json": "46ea3e2687b70632ad2ee726742f8b7d8a09dfc87da9a7eec7cbdcc309fb16b9",
  "config/development/orders.json": "309af3c34d4b95b1eacd101a8b2ab6fbd20dd6855715b2ab9b8eeaeb7e4964e5",
  "config/development/search-indexer.json": "78357429af4f47b4646056a38794600e8c18e68b02f6abe5c1fd2ce33fab1b97",
  "config/development/user-profile.json": "20f1751f4ef113bce219355e9037254a09c0d38cd2e4f6e17c8e5eba894edae8",
  "config/production/api-gateway.json": "88549af4a8adbc2416f3e92a4b1906858787c54ae6e6b0123efc01047fd61723",
  "config/production/billing-worker.json": "665fc7739c5c72be4595abd0cba26071fe9d5b10bd6e1864a77161e59bd1e02b",
  "config/production/email-dispatch.json": "0bdcbaf9433c9b9f2343452d18a419a40db5a3429b9d6d32b23f85305389340d",
  "config/production/inventory.json": "82508353a8df72ef45d185c7c5c8289d7bd97ccc530f6b99f35231cb48c32e7b",
  "config/production/media-proxy.json": "4c1ffbc298b975a91c1314226b4d643c3c7051043c6a452aad001a90fd7878ae",
  "config/production/orders.json": "f6b3e72f63f5bb99547339a96c0ab737b8419b2624f48176fd1a92761f95ab01",
  "config/production/overrides.json": "248bc6e4b6016fcf641c56e01ec70a181570dca16f93357d9432f48f8dfd2d86",
  "config/production/search-indexer.json": "56a342ff764424e7cda6083382343e3c64870d8fa3db5d6f3a875ff52b4ce4f4",
  "config/production/user-profile.json": "ef5bb5e479c261d326803b70276378570f3b96495086be40537d9c57469fcb0f",
  "config/staging/api-gateway.json": "b8cffc9caed392dacf72ef7cff7a72cec2d43a2a6a7630ebc0c029626a2c5ba0",
  "config/staging/billing-worker.json": "a7da16b7a165a3f9a57ab5379fd894bcefb493408b20143a4ba916d42256fc4b",
  "config/staging/catalog.json": "a9234333a0778b26228c23d6026f755a76e6828b872a1fea20c1e586e3a92f9a",
  "config/staging/email-dispatch.json": "93fa6d0e5c22f8b0c74b5c3234dbe9a88119474b6c47604accd410ade52140f9",
  "config/staging/inventory.json": "e26be0692b185ee62e36b39cb2efdd3bf2230d73e642e1e6e4ec0671a7f8b1e0",
  "config/staging/media-proxy.json": "9792350b56379025ba7e5e84f5a0c60f757781cbe7c530c6572f52908db48765",
  "config/staging/orders.json": "671e1c261d205e41c00030a8e75418c3ab722a3e9248463de7f663a99cacb46a",
  "config/staging/search-indexer.json": "59d1c1a3adb1e39928fd0bc8b34a8c7d23abd0976d7601551fed0629a83a89cb",
  "config/staging/user-profile.json": "a2a04728a6ba1a505e5e16596164b2e16baf20bf5058b35efbb7b64282168034",
  "data/deploy-history.jsonl": "58503b8c3e722421139db5acf2c70a0bf6da386e9d8f4e3e4d94ff3c679563ca",
  "data/request-metrics.csv": "b76ff2dce0993be669744cfbe5d9cfb4b414051faf685eae3c029f5bd1e5c2a3",
  "docs/operations.md": "81e3dd159425a86e0f36d89c842cf628e5a2181f176b8de7b79f543ab676473c",
  "logs/platform.log": "e18ec7b0cff4600d96dcdf7e7586ba742725e637a59d2ac13293b5d25a2973a4",
  "notes/old-capacity-review.md": "0d0ff639c917414c6adf04de694586eb9dbd6bc8fe33215d9a83cf2e01bc8c4e",
  "package.json": "16fc1025491f32a91fdde5bf9ede4706e4c2a43cf719298043db057a6c82b3c8",
  "scripts/render-config.js": "22ad8334a7e319c862810d35c810792bd99ea25a46c190a0cbe309eabd5ac4de",
  "test/index.js": "a30ba67f09ce50454bdb9d0d914ed121df346e905129af34fd2aaa139e82bf66",
  "tools/rotate-local-log.js": "b162cbc4e14c59331198967f8a150e7ecb776dc8282dcdb6b30674643768b6ef"
};

function repositoryHashes() {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['hidden', 'answers'].includes(entry.name)) visit(absolute);
      } else if (absolute !== answerPath && entry.name !== 'hidden-check.test.js') {
        const relative = path.relative(__dirname, absolute);
        if (relative !== 'config/production/catalog.json') files.push(relative);
      }
    }
  }
  visit(__dirname);
  files.sort();
  return Object.fromEntries(files.map((file) => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex'),
  ]));
}

test('all repository inputs remain unchanged', () => {
  assert.deepEqual(repositoryHashes(), EXPECTED_FILES);
});
