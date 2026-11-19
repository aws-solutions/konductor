'use strict';

class PermissionService {
  constructor({ store, cache }) {
    this.store = store;
    this.cache = cache;
  }

  getPermissions(id) {
    const key = `permissions:${id}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return { ...cached, roles: [...cached.roles] };
    const permissions = this.store.getPermissions(id);
    if (permissions) this.cache.set(key, permissions);
    return permissions;
  }

  updatePermissions(id, roles) {
    const permissions = this.store.updatePermissions(id, roles);
    if (!permissions) return null;
    this.cache.set(`permissions:${id}`, permissions);
    return { ...permissions, roles: [...permissions.roles] };
  }
}

module.exports = { PermissionService };
