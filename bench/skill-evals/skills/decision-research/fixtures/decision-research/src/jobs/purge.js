async function purgeExpired() { /* DELETE FROM tokens WHERE expires_at < now() */ }
module.exports = { purgeExpired };
