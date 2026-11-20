'use strict';
function notificationService() { return { publish() { return { delivered: false, reason: 'local-mode' }; } }; }
module.exports = { notificationService };
