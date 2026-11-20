"use strict";
const defaults = Object.freeze({ locale: "en-US", defaultCurrency: "USD", pageSize: 25 });
function loadConfig(overrides = {}) { return { ...defaults, ...overrides }; }
module.exports = { defaults, loadConfig };
