'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('loads src/date-range-picker.js', () => { assert.ok(require("../src/date-range-picker.js")); });
test('loads src/index.js', () => { assert.ok(require("../src/index.js")); });
test('loads src/price.js', () => { assert.ok(require("../src/price.js")); });
test('loads src/store.js', () => { assert.ok(require("../src/store.js")); });
test('loads src/timing.js', () => { assert.ok(require("../src/timing.js")); });
test('loads src/validation.js', () => { assert.ok(require("../src/validation.js")); });
test('loads src/view-model.js', () => { assert.ok(require("../src/view-model.js")); });
