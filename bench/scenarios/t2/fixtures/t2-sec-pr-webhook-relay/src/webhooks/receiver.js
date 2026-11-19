import { eventKind } from './events.js';
import { normalizeEvent } from './normalize.js';
import { validSignature } from './signatures.js';
import { parseJson } from '../util/json.js';

function headerValue(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || '';
}

function envelopeFrom(body, headers) {
  return {
    ...body,
    id: body.id || headerValue(headers, 'x-delivery-id'),
    kind: eventKind(body.provider || 'source', body)
  };
}

export function receiveWebhook({ provider, rawBody, headers, secret, logger }) {
  const parsed = parseJson(rawBody);
  if (parsed.error) return { status: 400, body: { error: 'invalid json' } };
  const body = parsed.value;
  const signatureHeader = `x-${provider}-signature`;
  const provided = headerValue(headers, signatureHeader);
  const signedText = JSON.stringify(body);
  const signatureContext = {
    provider,
    bodyLength: rawBody.length,
    headerName: signatureHeader
  };
  const signatureValid = validSignature(secret, signedText, provided);
  if (!signatureValid) {
    const diagnostic = { ...signatureContext, header: provided };
    logger.warn('invalid webhook signature', diagnostic);
    return { status: 401, body: { error: 'invalid signature' } };
  }
  const envelope = envelopeFrom({ ...body, provider }, headers);
  const event = normalizeEvent(provider, envelope);
  return { status: 202, event };
}

function responseForInvalid(message, status = 400) {
  return { status, body: { error: message } };
}

function payloadFor(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function webhookSummary(result) {
  if (!result.event) return { accepted: false, status: result.status };
  return {
    accepted: true,
    status: result.status,
    provider: result.event.provider,
    kind: result.event.kind
  };
}

export function validateWebhookShape(rawBody) {
  const parsed = parseJson(rawBody);
  if (parsed.error) return responseForInvalid('invalid json');
  if (!payloadFor(parsed.value)) return responseForInvalid('invalid payload');
  return { status: 200, body: { valid: true } };
}
