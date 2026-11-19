const { createSmsProvider } = require('./providers/sms');
const { createEmailProvider } = require('./providers/email');
const { normalizePhone, limitMessage } = require('./utils');

function createNotificationService(config, transports = {}) {
  const sms = createSmsProvider({ token: config.smsApiToken, transport: transports.sms });
  const email = createEmailProvider({ transport: transports.email });
  return {
    send(notification) {
      if (!notification || !notification.channel) throw new TypeError('channel is required');
      const body = limitMessage(notification.body || '');
      if (notification.channel === 'sms') {
        return sms.send(normalizePhone(notification.to), body);
      }
      if (notification.channel === 'email') {
        return email.send(notification.to, notification.subject || 'Notification', body);
      }
      throw new Error(`Unsupported channel: ${notification.channel}`);
    }
  };
}

module.exports = { createNotificationService };
