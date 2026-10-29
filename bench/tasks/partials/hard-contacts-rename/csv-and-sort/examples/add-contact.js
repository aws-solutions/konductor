'use strict';

const { createContactService } = require('../src');

const contacts = createContactService();
const ada = contacts.create({ displayName: 'Ada Lovelace', email: 'ADA@example.com' });
console.log(ada.displayName, ada.email);
