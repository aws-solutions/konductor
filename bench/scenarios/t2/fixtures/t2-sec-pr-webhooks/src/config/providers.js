/**
 * Provider configuration
 */

export const PROVIDERS = {
  GITHUB: {
    name: 'GitHub',
    signatureHeader: 'X-Hub-Signature-256',
    deliveryIdHeader: 'X-GitHub-Delivery',
    eventHeader: 'X-GitHub-Event',
    signaturePrefix: 'sha256=',
    timestampWindow: 10 * 60 * 1000, // 10 minutes
    webhookTypes: ['push', 'pull_request', 'issues', 'deployment']
  },
  
  STRIPE: {
    name: 'Stripe',
    signatureHeader: 'Stripe-Signature',
    webhookIdField: 'id', // In payload body
    timestampWindow: 5 * 60 * 1000, // 5 minutes
    signatureFormat: 'v1,timestamp,signature'
  },
  
  GENERIC: {
    name: 'Generic',
    signatureHeader: 'X-Signature',
    deliveryIdHeader: 'X-Delivery-Id',
    timestampHeader: 'X-Timestamp',
    callbackHeader: 'X-Callback-Url',
    signaturePrefix: 'sha256=',
    timestampWindow: 5 * 60 * 1000, // 5 minutes
    deliveryIdWindow: 10 * 60 * 1000 // 10 minutes
  },
  
  CUSTOM: {
    name: 'Custom',
    // Configurable per customer
    configurable: true
  }
};

/**
 * Get provider configuration by name
 * @param {string} providerName - Provider name
 * @returns {Object|null} Provider configuration
 */
export function getProviderConfig(providerName) {
  const key = providerName?.toUpperCase();
  return PROVIDERS[key] || null;
}

/**
 * Check if provider requires timestamp validation
 * @param {string} providerName - Provider name
 * @returns {boolean} True if timestamp validation required
 */
export function requiresTimestamp(providerName) {
  const config = getProviderConfig(providerName);
  return config?.timestampHeader !== undefined;
}

/**
 * Check if provider requires delivery ID tracking
 * @param {string} providerName - Provider name
 * @returns {boolean} True if delivery ID tracking required
 */
export function requiresDeliveryId(providerName) {
  const config = getProviderConfig(providerName);
  return config?.deliveryIdHeader !== undefined;
}