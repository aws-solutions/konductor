/**
 * Main application entry point
 */

import express from 'express';
import { ENV } from './config/env.js';
import { logger } from './utils/logger.js';
import { handleGitHubWebhook } from './handlers/github.js';
import { handleStripeWebhook } from './handlers/stripe.js';
import { handleGenericWebhook } from './handlers/generic.js';
import { handleNotify } from './handlers/notify.js';

const app = express();

// Middleware
app.use(express.json({ 
  verify: (req, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf.toString('utf8');
  }
}));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Routes
app.post('/webhooks/github', handleGitHubWebhook);
app.post('/webhooks/stripe', handleStripeWebhook);
app.post('/webhooks/generic', handleGenericWebhook);
app.post('/notify', handleNotify);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.2.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = ENV.PORT;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    webhookSecret: ENV.WEBHOOK_SECRET ? 'configured' : 'using default'
  });
});