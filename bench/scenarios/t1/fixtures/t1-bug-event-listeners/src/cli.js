'use strict';

const { NotificationService, WebSocketStub } = require('./');

const userIndex = process.argv.indexOf('--user');
const userId = userIndex >= 0 ? process.argv[userIndex + 1] : 'demo';
const service = new NotificationService({ heartbeatIntervalMs: 30000 });
const connection = new WebSocketStub(`cli:${userId}`);
connection.on('sent', (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`));
service.connect(userId, connection);
service.notify(userId, { type: 'ready', userId }).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
process.stdin.resume();
process.stdin.on('end', () => {
  service.close();
  connection.close();
});
