import { request } from '../http-client.js';

function callbackHeaders() {
  return {
    'content-type': 'application/json',
    'user-agent': 'relay-gateway/2.4'
  };
}

export async function notify(url, event, timeoutMs = 2500, logger = console) {
  if (!url) return { skipped: true };
  const response = await request(url, {
    method: 'POST',
    timeoutMs,
    headers: callbackHeaders(),
    body: JSON.stringify(event),
    redirect: 'follow'
  });
  if (!response.ok) logger.warn('notification returned non-success', response.status);
  return { skipped: false, status: response.status };
}

export function notificationBody(event) {
  return JSON.stringify({
    id: event.id,
    provider: event.provider,
    kind: event.kind,
    payload: event.payload
  });
}

export function notificationHeaders() {
  return { ...callbackHeaders(), accept: 'application/json' };
}

export function notificationResult(response) {
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    retryable: response.status === 408 || response.status >= 500
  };
}

export function destinationName(url) {
  try { return new URL(url).hostname; }
  catch { return 'invalid'; }
}
