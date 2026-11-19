'use strict';

class ProfileService {
  constructor({ store, cache }) {
    this.store = store;
    this.cache = cache;
  }

  getProfile(id) {
    const key = `profile:${id}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return { ...cached };
    const profile = this.store.getProfile(id);
    if (profile) this.cache.set(key, profile);
    return profile;
  }

  updateProfile(id, patch) {
    const profile = this.store.updateProfile(id, patch);
    if (!profile) return null;
    this.cache.set(`profile:${id}`, profile);
    return { ...profile };
  }
}

module.exports = { ProfileService };
