'use strict';

const { TTLCache } = require('./cache/ttl-cache');
const { DataStore } = require('./data/store');
const { ProfileService } = require('./services/profile-service');
const { PermissionService } = require('./services/permission-service');
const { profileHandler } = require('./handlers/profile-handler');
const { permissionHandler } = require('./handlers/permission-handler');

function createApp({ profiles = [], permissions = [], cacheOptions = {} } = {}) {
  const store = new DataStore({ profiles, permissions });
  const cache = new TTLCache(cacheOptions);
  const profilesService = new ProfileService({ store, cache });
  const permissionsService = new PermissionService({ store, cache });
  return {
    cache,
    store,
    profile: (request) => profileHandler(profilesService, request),
    permissions: (request) => permissionHandler(permissionsService, request),
    close: () => cache.close()
  };
}

module.exports = { createApp };
