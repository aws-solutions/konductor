'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('loads src/api.js', () => { assert.ok(require("../src/api.js")); });
test('loads src/calendar.js', () => { assert.ok(require("../src/calendar.js")); });
test('loads src/config.js', () => { assert.ok(require("../src/config.js")); });
test('loads src/ids.js', () => { assert.ok(require("../src/ids.js")); });
test('loads src/index.js', () => { assert.ok(require("../src/index.js")); });
test('loads src/jobs.js', () => { assert.ok(require("../src/jobs.js")); });
test('loads src/outbox.js', () => { assert.ok(require("../src/outbox.js")); });
test('loads src/rate-limiter.js', () => { assert.ok(require("../src/rate-limiter.js")); });
test('loads src/reminder-service.js', () => { assert.ok(require("../src/reminder-service.js")); });
test('loads src/scheduler.js', () => { assert.ok(require("../src/scheduler.js")); });
test('loads src/worker.js', () => { assert.ok(require("../src/worker.js")); });
