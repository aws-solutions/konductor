'use strict';
const test=require('node:test'); const assert=require('node:assert'); const {execFileSync}=require('node:child_process');
test('json checker passes',()=>assert.doesNotThrow(()=>execFileSync(process.execPath,['scripts/check-json.js'])));
test('doc checker passes',()=>assert.doesNotThrow(()=>execFileSync(process.execPath,['scripts/check-doc-links.js'])));
