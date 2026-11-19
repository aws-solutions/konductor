function testConfig(overrides = {}) {
  return { smsApiToken: 'test-token', webhookSigningSecret: 'test-signing', ...overrides };
}
module.exports = { testConfig };
