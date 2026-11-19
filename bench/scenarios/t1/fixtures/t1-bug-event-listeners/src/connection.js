'use strict';

const { EventEmitter } = require('node:events');

class WebSocketStub extends EventEmitter {
  constructor(name = 'anonymous') {
    super();
    this.name = name;
    this.readyState = 'OPEN';
    this.sentMessages = [];
    this.pingCount = 0;
  }

  send(payload) {
    if (this.readyState !== 'OPEN') {
      throw new Error(`Connection ${this.name} is not open`);
    }
    this.sentMessages.push(payload);
    this.emit('sent', payload);
  }

  ping() {
    if (this.readyState === 'OPEN') this.pingCount += 1;
  }

  close() {
    if (this.readyState === 'CLOSED') return;
    this.readyState = 'CLOSED';
    this.emit('close');
  }

  onMessage(handler) {
    this.on('message', handler);
    return () => this.off('message', handler);
  }

  receive(payload) {
    if (this.readyState !== 'OPEN') return;
    this.emit('message', payload);
  }
}

module.exports = { WebSocketStub };
