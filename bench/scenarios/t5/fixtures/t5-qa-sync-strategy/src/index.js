const { loadConfig } = require('./config');
const { LegacyStore } = require('./stores/legacy-store');
const { NewStore } = require('./stores/new-store');

function createStores(rows = []) { return { config: loadConfig(), source: new LegacyStore(rows), target: new NewStore() }; }
module.exports = { createStores };
