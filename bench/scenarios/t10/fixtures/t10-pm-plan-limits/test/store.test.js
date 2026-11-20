'use strict';
const test=require('node:test'); const assert=require('node:assert'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createJsonStore}=require('../src/store/json-store');
function store(){return createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sprig-')),'x.json'),{items:[]});}
test('writes and reads JSON',()=>{const s=store(); s.write({items:[1]}); assert.deepStrictEqual(s.read(),{items:[1]});});
test('serializes member-style work',async()=>{const s=store(); let n=0; await Promise.all([s.withLock(async()=>{const v=++n; await Promise.resolve(); return v}),s.withLock(async()=>++n)]); assert.strictEqual(n,2);});
test('creates parent directory',()=>assert.ok(store().file));
