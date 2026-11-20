'use strict';
const test = require('node:test'); const assert = require('node:assert'); const path = require('node:path'); const {loadConfig}=require('../src/config');
test('loads four plans',()=>assert.deepStrictEqual(Object.keys(loadConfig(path.join(__dirname,'..')).plans),['free','team','business','legacy']));
test('defaults include batch size',()=>assert.strictEqual(loadConfig(path.join(__dirname,'..')).defaults.batchMaxRows,40));
