'use strict';
const test=require('node:test'); const assert=require('node:assert'); const {clean,sameText}=require('../src/lib/strings'); const {isDateString}=require('../src/lib/dates');
test('cleans surrounding spaces',()=>assert.strictEqual(clean(' x '),'x'));
test('compares text without case',()=>assert.ok(sameText('Roadmap','roadmap')));
test('accepts ISO date',()=>assert.ok(isDateString('2024-01-01T00:00:00Z')));
test('rejects an empty value',()=>assert.strictEqual(require('../src/lib/validation').isNonEmptyString('',5),false));
test('accepts a short value',()=>assert.strictEqual(require('../src/lib/validation').isNonEmptyString('ok',5),true));
