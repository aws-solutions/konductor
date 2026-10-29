'use strict';

const path = require('node:path');
const { listCustomers } = require('../src');

for (const c of listCustomers(path.join(__dirname, '..', 'data'))) console.log(`${c.id}  ${c.name}  ${c.email ?? ''}`);
