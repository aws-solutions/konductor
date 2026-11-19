'use strict';

const { NotificationService, WebSocketStub } = require('../src');

const service = new NotificationService({ heartbeatIntervalMs: 1000 });
const socket = new WebSocketStub('sample');
socket.on('sent', (message) => console.log('message', message));
service.connect('sample-user', socket);
service.notify('sample-user', { type: 'sample', text: 'hello' }).then(() => {
  service.close();
  socket.close();
});
