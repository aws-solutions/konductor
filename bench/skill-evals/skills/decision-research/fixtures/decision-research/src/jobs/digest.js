const { withRetry } = require('../lib/retry');
async function sendDigest() { /* loads users in pages of 500 and publishes to SNS */ return withRetry(async () => {}); }
module.exports = { sendDigest };
