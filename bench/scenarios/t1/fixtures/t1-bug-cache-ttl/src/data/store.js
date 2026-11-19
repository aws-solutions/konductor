'use strict';

class DataStore {
  constructor({ profiles = [], permissions = [] } = {}) {
    this.profiles = new Map(profiles.map((record) => [record.id, { ...record }]));
    this.permissions = new Map(permissions.map((record) => [record.id, { ...record, roles: [...record.roles] }]));
  }

  getProfile(id) {
    const record = this.profiles.get(id);
    return record ? { ...record } : null;
  }

  updateProfile(id, patch) {
    const current = this.profiles.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.profiles.set(id, next);
    return { ...next };
  }

  getPermissions(id) {
    const record = this.permissions.get(id);
    return record ? { ...record, roles: [...record.roles] } : null;
  }

  updatePermissions(id, roles) {
    if (!this.permissions.has(id)) return null;
    const next = { id, roles: [...roles] };
    this.permissions.set(id, next);
    return { ...next, roles: [...next.roles] };
  }
}

module.exports = { DataStore };
