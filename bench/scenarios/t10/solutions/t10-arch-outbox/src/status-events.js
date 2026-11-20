'use strict';
const { nextId } = require('./util/ids');
const { clone } = require('./util/clone');
const MAX_BROKER_BYTES = 2048;
function asMs(value) { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? n : 0; }
function appendStatusEvent(store, orderId, status, occurredAt, options = {}) {
  const orders = store.read('orders'); const order = options.order || orders.find(x => x.id === orderId);
  if (!order) { const e = new Error('order not found'); e.code = 'ORDER_NOT_FOUND'; throw e; }
  const statusEvents = store.read('statusEvents');
  const duplicate = statusEvents.find(x => x.orderId === orderId && x.status === status && !x.deadLetter);
  if (duplicate) return duplicate;
  const id = options.eventId || nextId('evt');
  const event = { id, type: 'payment.status.changed', topic: 'payment.status.changed', orderId, status,
    occurredAt, payload: options.event?.payload || { orderId, status, updatedAt: occurredAt }, attempts: 0,
    nextAttemptAt: asMs(occurredAt), sentAt: null, claimedBy: null, claimUntil: 0, deadLetter: false, lastError: null };
  const nextOrders = orders.map(x => x.id === orderId ? order : x);
  store.atomicWrite({ orders: nextOrders, statusEvents: statusEvents.concat(event) }); return event;
}
function nowValue(options) { return typeof options.now === 'function' ? Number(options.now()) : Date.now(); }
function dueEvents(store, now) {
  const events = store.read('statusEvents').map(e => ({ attempts: 0, nextAttemptAt: 0, claimUntil: 0, ...e }));
  const byOrder = new Map();
  for (const e of events.filter(e => !e.sentAt && !e.deadLetter).sort((a,b) => asMs(a.occurredAt)-asMs(b.occurredAt) || String(a.id).localeCompare(String(b.id)))) {
    if (!byOrder.has(e.orderId)) byOrder.set(e.orderId, e);
  }
  return [...byOrder.values()].filter(e => e.nextAttemptAt <= now && (!e.claimedBy || e.claimUntil <= now));
}
function claim(store, event, instanceId, claimUntil) {
  const events = store.read('statusEvents'); const current = events.find(x => x.id === event.id);
  if (!current || current.sentAt || current.deadLetter || (current.claimedBy && current.claimUntil > claimUntil - 1)) return null;
  const claimed = { ...current, claimedBy: instanceId, claimUntil: claimUntil };
  store.atomicWrite({ statusEvents: events.map(x => x.id === event.id ? claimed : x) }); return claimed;
}
function publishWithTimeout(broker, topic, message, timeoutMs) {
  let timer;
  const call = Promise.resolve().then(() => broker.publish(topic, message));
  if (!timeoutMs || timeoutMs <= 0) return call;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error('broker publish timed out'); e.code = 'BROKER_TIMEOUT'; reject(e); }, timeoutMs); if (timer.unref) timer.unref(); });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}
async function publishPending(store, broker, options = {}) {
  const now = nowValue(options); const instanceId = options.instanceId || 'publisher'; const claimMs = options.claimMs ?? 30000;
  const baseDelayMs = options.baseDelayMs ?? 1000; const maxAttempts = options.maxAttempts ?? 5; const limit = options.limit ?? 10; const concurrency = options.concurrency ?? 4;
  const metrics = options.metrics; const selected = [];
  for (const candidate of dueEvents(store, now)) { if (selected.length >= limit || selected.length >= concurrency) break; const e = claim(store, candidate, instanceId, now + claimMs); if (e) selected.push(e); }
  const outcomes = await Promise.all(selected.map(async event => {
    const message = { headers: { 'x-event-id': event.id }, eventId: event.id, orderId: event.orderId, status: event.status, occurredAt: event.occurredAt, payload: clone(event.payload) };
    try {
      const bytes = Buffer.byteLength(JSON.stringify({ topic: event.topic, message }));
      if (bytes > MAX_BROKER_BYTES) { const e = new Error('message exceeds broker limit'); e.code = 'BROKER_MESSAGE_TOO_LARGE'; throw e; }
      await publishWithTimeout(broker, event.topic, message, options.publishTimeoutMs);
      const current = store.read('statusEvents'); store.atomicWrite({ statusEvents: current.map(x => x.id === event.id ? { ...x, sentAt: new Date(now).toISOString(), claimedBy: null, claimUntil: 0 } : x) });
      metrics?.increment('broker.published'); return { ok: true, eventId: event.id };
    } catch (error) {
      const current = store.read('statusEvents'); const item = current.find(x => x.id === event.id); const attempts = (item?.attempts || 0) + 1;
      const terminal = attempts >= maxAttempts; const next = { ...item, attempts, lastError: error.code || error.message, deadLetter: terminal, nextAttemptAt: terminal ? 0 : now + baseDelayMs * (2 ** (attempts - 1)), claimedBy: null, claimUntil: 0 };
      store.atomicWrite({ statusEvents: current.map(x => x.id === event.id ? next : x) }); metrics?.increment('broker.errors');
      return { ok: false, eventId: event.id, deadLetter: terminal, code: next.lastError };
    }
  }));
  return { attempted: selected.length, published: outcomes.filter(x => x.ok).length, failed: outcomes.filter(x => !x.ok).length, deadLettered: outcomes.filter(x => x.deadLetter).length, outcomes };
}
module.exports = { MAX_BROKER_BYTES, appendStatusEvent, publishPending };
