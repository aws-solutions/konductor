'use strict';
const test=require('node:test'); const assert=require('node:assert'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createJsonStore}=require('../src/store/json-store'); const {memberRepository}=require('../src/repositories/members');
function repo(){return memberRepository(createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sprig-')),'x.json'),{members:[]}));}
test('invites member',async()=>{const r=repo(); const m=await r.invite({accountId:'a',email:'x@example.test'}); assert.strictEqual(m.state,'invited');});
test('activates member',async()=>{const r=repo(); const m=await r.invite({accountId:'a',email:'x@example.test'}); assert.strictEqual(r.activate(m.id).state,'active');});
