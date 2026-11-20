'use strict';
const test=require('node:test'); const assert=require('node:assert'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createJsonStore}=require('../src/store/json-store'); const {createApp}=require('../src/app');
function app(){return createApp({store:createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sprig-')),'x.json'),{accounts:[],projects:[],members:[]})});}
test('health route works',async()=>assert.strictEqual((await app().handle('GET','/health',{})).status,200));
test('unknown route is 404',async()=>assert.strictEqual((await app().handle('GET','/nope',{})).status,404));
test('account project route creates',async()=>{const x=app(); x.accounts.create({id:'a',name:'A'}); assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name:'A project'})).status,201);});
