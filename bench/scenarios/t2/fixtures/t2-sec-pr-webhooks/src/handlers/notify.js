/**
 * Notification forwarding handler
 * Allows customers to configure endpoints where webhook payloads are forwarded
 */

import { logger } from '../utils/logger.js';
import { forwardToNotificationEndpoint } from './generic.js';

/**
 * Handle notification forwarding request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export async function handleNotify(req, res) {
  const { url, payload, secret } = req.body;
  
  // Validate required fields
  if (!url || !payload || !secret) {
    res.status(400).json({ error: 'Missing required fields: url, payload, secret' });
    return;
  }
  
  // Simple secret check (in production would be more robust)
  if (secret !== process.env.NOTIFY_SECRET) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }
  
  try {
    // Forward to the customer-provided URL
    // NOTE: This does NOT validate the URL - it will fetch ANY URL provided!
    const result = await forwardToNotificationEndpoint(url, payload);
    
    logger.info('Notification forwarded successfully', {
      url,
      status: result.status
    });
    
    res.status(200).json({
      success: true,
      forwarded: true,
      endpointResponse: result
    });
    
  } catch (error) {
    logger.error('Notification forwarding failed', {
      url,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to forward notification',
      details: error.message
    });
  }
}