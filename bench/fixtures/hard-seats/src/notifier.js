'use strict';

/** Sends booking confirmations through `transport` (a function returning a promise). The default keeps them in `sent`. */
function createNotifier({ transport } = {}) {
  const sent = [];
  const send = transport || (async (booking) => { sent.push(booking); });
  return { sent, send };
}

module.exports = { createNotifier };
