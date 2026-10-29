'use strict';

module.exports = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '127.0.0.1',
  adminToken: process.env.ADMIN_TOKEN || 'FAKE-ADMIN-TOKEN-0000-placeholder',
  reorderLevel: 5,
};
