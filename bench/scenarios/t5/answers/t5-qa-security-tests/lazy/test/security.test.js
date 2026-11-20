'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('loads src/audit-log.js', () => { assert.ok(require("../src/audit-log.js")); });
test('loads src/auth/rate-limit.js', () => { assert.ok(require("../src/auth/rate-limit.js")); });
test('loads src/auth/roles.js', () => { assert.ok(require("../src/auth/roles.js")); });
test('loads src/auth/session.js', () => { assert.ok(require("../src/auth/session.js")); });
test('loads src/documents/access.js', () => { assert.ok(require("../src/documents/access.js")); });
test('loads src/export/html.js', () => { assert.ok(require("../src/export/html.js")); });
test('loads src/handlers/documents.js', () => { assert.ok(require("../src/handlers/documents.js")); });
test('loads src/handlers/download.js', () => { assert.ok(require("../src/handlers/download.js")); });
test('loads src/handlers/login.js', () => { assert.ok(require("../src/handlers/login.js")); });
test('loads src/index.js', () => { assert.ok(require("../src/index.js")); });
test('loads src/storage/download.js', () => { assert.ok(require("../src/storage/download.js")); });
test('loads src/validation/input.js', () => { assert.ok(require("../src/validation/input.js")); });
