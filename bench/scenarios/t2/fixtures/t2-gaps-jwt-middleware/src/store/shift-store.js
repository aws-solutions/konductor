const fs = require('node:fs');

class ShiftStore {
  constructor(file) { this.file = file; this.shifts = JSON.parse(fs.readFileSync(file, 'utf8')); }
  all() { return [...this.shifts]; }
  forDate(date) { return this.shifts.filter((shift) => shift.date === date); }
  add(shift) { this.shifts.push(shift); fs.writeFileSync(this.file, JSON.stringify(this.shifts, null, 2) + '\n'); return shift; }
}

module.exports = { ShiftStore };
