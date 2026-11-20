'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('../src/store');
const { createOrder, updatePaymentStatus } = require('../src/orders');
const { publishPending } = require('../src/status-events');
const { InProcessBroker } = require('../src/broker');
function setup() { const d=fs.mkdtempSync(path.join(os.tmpdir(),'visible-')); const store=createJsonStore(path.join(d,'data.json')); const clock={now:()=>Date.parse('2025-01-01T00:00:00Z')}; return {store,clock}; }
test('visible statusEvents write keeps the transition',()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});assert.equal(store.read('statusEvents').length,1);});
test('visible publisher uses the event header',async()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});const b=new InProcessBroker();await publishPending(store,b,{now:clock.now,instanceId:'visible'});assert.ok(b.messages[0].message.headers['x-event-id']);});
test('visible publisher leaves a failed event',async()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});const b=new InProcessBroker({publish(){throw new Error('no');}});await publishPending(store,b,{now:clock.now,instanceId:'visible'});assert.equal(store.read('statusEvents')[0].attempts,1);});
test('visible config has millisecond publisher settings',()=>{const {loadConfig}=require('../src/config');const c=loadConfig({STATUS_EVENTS_PUBLISH_CLAIM_MS:'42'});assert.equal(c.statusEventsPublishClaimMs,42);});
test('visible store reads legacy collections',()=>{const {store}=setup();store.atomicWrite({orders:[{id:'x'}]});assert.equal(store.read('orders')[0].id,'x');});
test('visible event topic is stable',()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});assert.equal(store.read('statusEvents')[0].topic,'payment.status.changed');});
test('visible failed publish has a retry timestamp',async()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});const b=new InProcessBroker({publish(){throw new Error('no');}});await publishPending(store,b,{now:clock.now,instanceId:'visible',baseDelayMs:10});assert.equal(store.read('statusEvents')[0].nextAttemptAt,clock.now()+10);});
test('visible publisher can process a second order',async()=>{const {store,clock}=setup();const o=createOrder(store,{externalReference:'v',amount:1},clock);updatePaymentStatus(store,o.id,'authorized',{clock});const b=new InProcessBroker();const r=await publishPending(store,b,{now:clock.now,instanceId:'visible'});assert.equal(r.published,1);});
