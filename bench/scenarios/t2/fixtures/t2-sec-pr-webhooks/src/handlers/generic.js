/**
 * Generic webhook handler with signature verification
 * Supports multiple providers through configuration
 */

import { createHmac } from 'node:crypto';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isValidCallbackUrl } from '../utils/validation.js';

// In-memory store for processed delivery IDs
// Note: This should be a proper database in production
const processedIds = new Set();

/**
 * Verify webhook signature
 * @param {Object} parsedBody - Parsed JSON body
 * @param {string} signatureHeader - Signature from X-Signature header
 * @param {string} secret - Shared secret
 * @returns {boolean} True if signature is valid
 */
export function verifyWebhookSignature(parsedBody, signatureHeader, secret = ENV.WEBHOOK_SECRET) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    logger.error('Invalid signature header format:', signatureHeader);
    return false;
  }
  
  const expectedSignature = signatureHeader.substring(7);
  
  // Re-serialize the parsed JSON for signature computation
  // This matches what the client would have signed
  const bodyString = JSON.stringify(parsedBody);
  const hmac = createHmac('sha256', secret);
  hmac.update(bodyString);
  const computedSignature = hmac.digest('hex');
  
  // Compare signatures
  return expectedSignature === computedSignature;
}

/**
 * Check if delivery ID has been processed recently
 * @param {string} deliveryId - Delivery ID from header
 * @returns {boolean} True if ID is a duplicate
 */
export function isDuplicateDelivery(deliveryId) {
  if (!deliveryId) {
    return false;
  }
  
  return processedIds.has(deliveryId);
}

/**
 * Store delivery ID to prevent replays
 * @param {string} deliveryId - Delivery ID to store
 */
export function storeDeliveryId(deliveryId) {
  if (deliveryId) {
    processedIds.add(deliveryId);
    
    // Simple cleanup - real implementation would use TTL
    if (processedIds.size > 10000) {
      processedIds.clear();
    }
  }
}

/**
 * Make outbound callback to customer URL
 * @param {string} callbackUrl - Customer's callback URL
 * @param {Object} payload - Payload to forward
 * @returns {Promise<Object>} Response from callback
 */
export async function notifyCallback(callbackUrl, payload) {
  if (!isValidCallbackUrl(callbackUrl)) {
    throw new Error('Invalid callback URL');
  }
  
  logger.info(`Making callback to: ${callbackUrl}`);
  
  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Webhook-Integration-Service/2.1.0'
      },
      body: JSON.stringify(payload),
      timeout: ENV.MAX_CALLBACK_TIMEOUT_MS
    });
    
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text().catch(() => '')
    };
  } catch (error) {
    logger.error(`Callback failed: ${error.message}`, { url: callbackUrl });
    throw error;
  }
}

/**
 * Handle generic webhook
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export async function handleGenericWebhook(req, res) {
  const { headers, body } = req;
  const signature = headers['x-signature'];
  const deliveryId = headers['x-delivery-id'];
  const timestamp = headers['x-timestamp'];
  const callbackUrl = headers['x-callback-url'] || body.callbackUrl;
  
  // Log incoming request (including signature for debugging)
  logger.debug('Generic webhook received', {
    deliveryId,
    timestamp,
    signature: signature ? `${signature.substring(0, 16)}...` : 'none'
  });
  
  // Check for duplicate delivery
  if (isDuplicateDelivery(deliveryId)) {
    logger.warn(`Duplicate delivery ID detected: ${deliveryId}`);
    res.status(400).json({ error: 'Duplicate webhook delivery' });
    return;
  }
  
  try {
    // Verify signature using parsed body
    const secret = ENV.WEBHOOK_SECRET;
    const isValid = verifyWebhookSignature(body, signature, secret);
    
    if (!isValid) {
      logger.error('Signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Store delivery ID to prevent replay
    storeDeliveryId(deliveryId);
    
    // Make callback if URL provided
    if (callbackUrl) {
      const callbackResult = await notifyCallback(callbackUrl, {
        event: 'webhook.received',
        payload: body,
        deliveryId,
        timestamp
      });
      
      logger.info('Callback completed', {
        status: callbackResult.status,
        url: callbackUrl
      });
    }
    
    res.status(200).json({ 
      received: true,
      deliveryId,
      callbackMade: !!callbackUrl
    });
    
  } catch (error) {
    logger.error('Generic webhook processing failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}