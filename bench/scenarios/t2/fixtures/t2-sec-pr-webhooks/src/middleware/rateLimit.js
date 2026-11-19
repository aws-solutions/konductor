/**
 * Rate limiting middleware
 */

import { logger } from '../utils/logger.js';

// Simple in-memory rate limiting
// In production, use Redis or similar
const requestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100;

function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, entry] of requestCounts.entries()) {
    if (now - entry.timestamp > WINDOW_MS) {
      requestCounts.delete(key);
    }
  }
}

export function rateLimit(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  const key = `rate:${clientIp}`;
  const now = Date.now();
  
  // Clean up old entries periodically
  if (Math.random() < 0.01) { // 1% chance on each request
    cleanupOldEntries();
  }
  
  const entry = requestCounts.get(key);
  
  if (!entry) {
    requestCounts.set(key, { count: 1, timestamp: now });
    return next();
  }
  
  if (now - entry.timestamp > WINDOW_MS) {
    // Window expired, reset
    requestCounts.set(key, { count: 1, timestamp: now });
    return next();
  }
  
  if (entry.count >= MAX_REQUESTS) {
    logger.warn('Rate limit exceeded', { ip: clientIp });
    res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: Math.ceil((entry.timestamp + WINDOW_MS - now) / 1000)
    });
    return;
  }
  
  entry.count++;
  next();
}