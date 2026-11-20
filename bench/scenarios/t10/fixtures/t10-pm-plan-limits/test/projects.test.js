'use strict';
const test=require('node:test'); const assert=require('node:assert'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createJsonStore}=require('../src/store/json-store'); const {projectRepository}=require('../src/repositories/projects');
function repo(data={accounts:[],projects:[]}){return projectRepository(createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sprig-')),'x.json'),data));}
test('lists one account only',()=>{const r=repo({projects:[{id:'p1',accountId:'a',name:'A'},{id:'p2',accountId:'b',name:'B'}]}); assert.strictEqual(r.list('a').length,1);});
test('archives project',()=>{const r=repo({projects:[{id:'p1',accountId:'a',name:'A',status:'active'}]}); assert.strictEqual(r.archive('p1').status,'archived');});
test('removes project as a tombstone',()=>{const r=repo({projects:[{id:'p1',accountId:'a',name:'A',status:'active'}]}); assert.strictEqual(r.remove('p1').status,'deleted');});
