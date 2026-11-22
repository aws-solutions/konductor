'use strict';

class AuditLog {
  constructor() {
    this.entries = [];
  }

  add(event, fields = {}) {
    this.entries.push({ event, at: Date.now(), ...fields });
  }

  all() {
    return this.entries.slice();
  }
}

module.exports = { AuditLog };
