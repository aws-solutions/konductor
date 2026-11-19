/**
 * GitHub webhook handler
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';

const DELIVERY_ID_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const deliveryIds = new Set();

function cleanupOldIds() {
  // In a real implementation, this would have timestamps
  // For now, just keep a simple size limit
  if (deliveryIds.size > 10000) {
    deliveryIds.clear();
  }
}

export function verifyGitHubSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    throw new Error('Invalid signature format');
  }
  
  const expectedSignature = signatureHeader.substring(7);
  const hmac = createHmac('sha256', ENV.WEBHOOK_SECRET);
  hmac.update(rawBody);
  const actualSignature = hmac.digest('hex');
  
  // Use timing-safe comparison
  return timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(actualSignature, 'hex')
  );
}

export async function handleGitHubWebhook(req, res) {
  const { headers, body } = req;
  const deliveryId = headers['x-github-delivery'];
  const eventType = headers['x-github-event'];
  
  // Check for replay
  if (deliveryId && deliveryIds.has(deliveryId)) {
    logger.warn(`Duplicate delivery ID: ${deliveryId}`);
    res.status(400).json({ error: 'Duplicate webhook delivery' });
    return;
  }
  
  try {
    // Verify signature using raw body
    const rawBody = req.rawBody || JSON.stringify(body);
    const isValid = verifyGitHubSignature(rawBody, headers['x-hub-signature-256']);
    
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Store delivery ID
    if (deliveryId) {
      deliveryIds.add(deliveryId);
      cleanupOldIds();
    }
    
    // Process event
    logger.info(`GitHub webhook: ${eventType}`, { deliveryId });
    
    // Forward to customer callback if configured
    // This would be handled by a separate service
    
    res.status(200).json({ received: true });
    
  } catch (error) {
    logger.error('GitHub webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}