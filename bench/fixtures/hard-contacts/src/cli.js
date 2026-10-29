'use strict';

const seed = require('../data/seed.json');
const { createContactService } = require('./service');

const service = createContactService();
for (const s of seed) service.create(s);
for (const c of service.list()) console.log(`${c.id}  ${c.fullName}  <${c.email}>`);
