'use strict';

// Tax rate by customer country (ISO 3166 alpha-2). Countries not listed pay no tax.
const RATES = { US: 0, DE: 0.19, FR: 0.2, GB: 0.2, JP: 0.1, CA: 0.05 };

module.exports = { RATES };
