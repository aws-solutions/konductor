'use strict';

const { createStore } = require('../src/store');
const { reconcile } = require('../src/reconcile');

const store = createStore({ accounts: [], journal: [] });
process.stdout.write(`${JSON.stringify(reconcile(store))}\n`);
