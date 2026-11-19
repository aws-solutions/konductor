const path = require('node:path');
const { UserStore } = require('../src/store/user-store');
const { ShiftStore } = require('../src/store/shift-store');

function fixtureStores() {
  return {
    users: new UserStore(path.join(__dirname, '..', 'data', 'users.json')),
    shifts: new ShiftStore(path.join(__dirname, '..', 'data', 'shifts.json')),
  };
}
module.exports = { fixtureStores };
