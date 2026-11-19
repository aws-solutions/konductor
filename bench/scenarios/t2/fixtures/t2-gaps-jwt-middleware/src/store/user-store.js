const fs = require('node:fs');

class UserStore {
  constructor(file) {
    this.file = file;
    this.users = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  findById(id) { return this.users.find((user) => user.id === id) || null; }
  findByEmail(email) { return this.users.find((user) => user.email === email) || null; }
  listActive() { return this.users.filter((user) => user.active); }

  updateRole(id, role) {
    const user = this.findById(id);
    if (!user) return null;
    user.role = role;
    fs.writeFileSync(this.file, JSON.stringify(this.users, null, 2) + '\n');
    return user;
  }
}

module.exports = { UserStore };
