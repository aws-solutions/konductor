'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('loads src/cli.js', () => { assert.ok(require("../src/cli.js")); });
test('loads src/errors.js', () => { assert.ok(require("../src/errors.js")); });
test('loads src/index.js', () => { assert.ok(require("../src/index.js")); });
test('loads src/parser.js', () => { assert.ok(require("../src/parser.js")); });
test('loads src/printer.js', () => { assert.ok(require("../src/printer.js")); });
test('loads src/schema.js', () => { assert.ok(require("../src/schema.js")); });
test('loads src/tokenizer.js', () => { assert.ok(require("../src/tokenizer.js")); });
test('loads src/validator.js', () => { assert.ok(require("../src/validator.js")); });
test('loads src/values.js', () => { assert.ok(require("../src/values.js")); });
