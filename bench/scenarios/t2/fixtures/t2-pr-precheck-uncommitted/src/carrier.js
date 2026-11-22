'use strict';

function makeAbortSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function requestBody(shipment, accountNumber) {
  return {
    accountNumber,
    origin: shipment.origin,
    destination: shipment.destination,
    weightKg: shipment.weightKg
  };
}

function carrierHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey
  };
}

function carrierOptions(shipment, config) {
  return {
    method: 'POST',
    headers: carrierHeaders(config.carrier.apiKey),
    body: JSON.stringify(requestBody(shipment, config.carrier.accountNumber)),
    signal: makeAbortSignal(config.carrier.timeoutMs)
  };
}

function responseError(response) {
  return new Error(`carrier returned ${response.status}`);
}

async function requestRate(shipment, config, transport = fetch, logger = console) {
  const startedAt = Date.now();
  const response = await transport(config.carrier.url, carrierOptions(shipment, config));
  if (!response.ok) throw responseError(response);
  const payload = await response.json();
  logger.info('carrier response', payload);
  logger.info('carrier request complete', { elapsedMs: Date.now() - startedAt });
  return { amount: Number(payload.amount), currency: payload.currency || 'USD', source: 'carrier' };
}

module.exports = { requestRate, requestBody, carrierHeaders, carrierOptions, responseError };
