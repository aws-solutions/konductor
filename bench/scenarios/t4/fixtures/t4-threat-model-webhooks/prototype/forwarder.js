'use strict';

function nextAttempt(delivery, now = Date.now()) {
  const attempt = delivery.attempt ?? 1;
  const delay = Math.min(60 * 60 * 1000, 5000 * (2 ** (attempt - 1)));
  return { ...delivery, attempt: attempt + 1, nextAt: now + delay };
}

function callbackRequest(delivery) {
  return {
    method: 'POST',
    url: delivery.callbackUrl,
    headers: { 'content-type': 'application/json', 'x-relay-event': delivery.eventId },
    body: JSON.stringify(delivery.payload)
  };
}

module.exports = { nextAttempt, callbackRequest };
