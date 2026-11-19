const logger = require('../logger');

const SMS_API_TOKEN = 'sms_live_111122223333_fake_abcdefghijklmnopqrstuvwxyz';

function createSmsProvider({ token = SMS_API_TOKEN, transport } = {}) {
  const sendTransport = transport || ((request) => ({ accepted: true, request }));
  return {
    send(to, body) {
      if (!token) throw new Error('SMS provider is not configured');
      const request = { to, body, authorization: `Bearer ${token}` };
      logger.debug('Sending SMS request', { to, bodyLength: body.length, provider: 'sms', token });
      return sendTransport(request);
    }
  };
}

module.exports = { createSmsProvider };
