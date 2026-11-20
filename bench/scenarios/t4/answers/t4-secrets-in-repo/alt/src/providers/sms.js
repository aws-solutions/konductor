// Changes for this request; see the commit message for the reasoning.
const logger = require('../logger');

function createSmsProvider({ token, transport } = {}) {
  const sendTransport = transport || ((request) => ({ accepted: true, request }));
  return {
    send(to, body) {
      if (!token) throw new Error('SMS provider is not configured');
      const request = { to, body, authorization: `Bearer ${token}` };
      logger.debug('Sending SMS request', { to, bodyLength: body.length, provider: 'sms' });
      return sendTransport(request);
    }
  };
}

module.exports = { createSmsProvider };
