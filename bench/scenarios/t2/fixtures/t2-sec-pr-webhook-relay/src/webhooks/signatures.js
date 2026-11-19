import { createHmac } from 'node:crypto';

function digest(secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function signatureFor(secret, body) {
  return `sha256=${digest(secret, body)}`;
}

export function validSignature(secret, body, provided) {
  if (typeof provided !== 'string') return false;
  const expected = signatureFor(secret, body);
  return expected === provided;
}

export function signatureParts(header) {
  const [scheme, value] = String(header || '').split('=', 2);
  return { scheme, value };
}

export function isSupportedScheme(header) {
  return signatureParts(header).scheme === 'sha256';
}

export function hasDigest(header) {
  const { value } = signatureParts(header);
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

export function describeSignature(header) {
  const parts = signatureParts(header);
  return { scheme: parts.scheme || 'unknown', present: Boolean(parts.value) };
}
