const cron = require('node-cron');
const { sendDigest } = require('./digest');
const { purgeExpired } = require('./purge');

// Runs on the single long-lived EC2 worker (see infra/stack.ts).
cron.schedule('0 7 * * *', sendDigest);      // daily digest emails, ~40k recipients
cron.schedule('*/15 * * * *', purgeExpired); // purge expired tokens
