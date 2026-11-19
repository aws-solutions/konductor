'use strict';

const crypto = require('node:crypto');
const { ValidationError } = require('./errors');

function signatureFor(raw, secret) { return crypto.createHmac('sha256', secret).update(raw).digest('hex'); }

function verifySignature(raw, signature, secret) {
  if (typeof raw !== 'string' || typeof signature !== 'string' || !secret) return false;
  const expected = signatureFor(raw, secret);
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function parseEvent(raw, signature, secret) {
  if (!verifySignature(raw, signature, secret)) throw new ValidationError('invalid webhook signature');
  try { return JSON.parse(raw); } catch { throw new ValidationError('invalid webhook payload'); }
}

function applyEvent(event, repository) {
  if (!event || !event.id || !event.type) throw new ValidationError('event identity is required');
  if (repository.hasEvent(event.id)) return { applied: false, duplicate: true };
  repository.saveEvent(event.id);
  return { applied: true, duplicate: false, type: event.type };
}

module.exports = { signatureFor, verifySignature, parseEvent, applyEvent };
