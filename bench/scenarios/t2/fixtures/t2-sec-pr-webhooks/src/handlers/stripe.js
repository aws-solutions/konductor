/**
 * Stripe webhook handler
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_ID_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const processedWebhookIds = new Set();

function cleanupOldWebhookIds() {
  // Simple cleanup - real implementation would track timestamps
  if (processedWebhookIds.size > 5000) {
    processedWebhookIds.clear();
  }
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) {
    throw new Error('Missing signature header');
  }
  
  const signatures = signatureHeader.split(',');
  const timestamp = signatures.find(s => s.startsWith('t='))?.substring(2);
  
  if (!timestamp) {
    throw new Error('Missing timestamp in signature');
  }
  
  // Check timestamp window
  const now = Date.now() / 1000;
  const timestampNum = parseInt(timestamp, 10);
  
  if (Math.abs(now - timestampNum) > TIMESTAMP_WINDOW_MS / 1000) {
    throw new Error('Timestamp outside acceptable window');
  }
  
  // Verify signatures
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignatures = signatures
    .filter(s => s.startsWith('v1='))
    .map(s => s.substring(3));
  
  for (const expectedSig of expectedSignatures) {
    const hmac = createHmac('sha256', secret);
    hmac.update(signedPayload);
    const computedSig = hmac.digest('hex');
    
    if (timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(computedSig, 'hex')
    )) {
      return true;
    }
  }
  
  return false;
}

export async function handleStripeWebhook(req, res) {
  const { headers, body } = req;
  const webhookId = body.id || headers['stripe-webhook-id'];
  
  // Check for replay
  if (webhookId && processedWebhookIds.has(webhookId)) {
    logger.warn(`Duplicate Stripe webhook ID: ${webhookId}`);
    res.status(400).json({ error: 'Duplicate webhook' });
    return;
  }
  
  try {
    // Verify signature
    const rawBody = req.rawBody || JSON.stringify(body);
    const isValid = verifyStripeSignature(
      rawBody,
      headers['stripe-signature'],
      ENV.WEBHOOK_SECRET
    );
    
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Store webhook ID
    if (webhookId) {
      processedWebhookIds.add(webhookId);
      cleanupOldWebhookIds();
    }
    
    // Process event
    logger.info('Stripe webhook processed', { 
      type: body.type,
      id: webhookId 
    });
    
    res.status(200).json({ received: true });
    
  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}