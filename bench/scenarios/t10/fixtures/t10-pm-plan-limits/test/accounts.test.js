'use strict';
const test=require('node:test'); const assert=require('node:assert'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createJsonStore}=require('../src/store/json-store'); const {accountRepository}=require('../src/repositories/accounts');
function repo(){return accountRepository(createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sprig-')),'x.json'),{accounts:[]}));}
test('creates a free account by default',()=>{const r=repo(); const a=r.create({name:'Acme'}); assert.strictEqual(a.plan,'free');});
test('finds account by id',()=>{const r=repo(); const a=r.create({id:'a1',name:'Acme'}); assert.strictEqual(r.get(a.id).name,'Acme');});
