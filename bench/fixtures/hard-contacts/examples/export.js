'use strict';

const seed = require('../data/seed.json');
const { createContactService } = require('../src');

const contacts = createContactService();
seed.forEach((s) => contacts.create(s));
process.stdout.write(contacts.exportCsv());
