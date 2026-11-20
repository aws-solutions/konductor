export class AuditLog {
  constructor() { this.entries = []; }
  record(action, fields) { this.entries.push({ action, ...fields }); }
  all() { return this.entries.map((entry) => ({ ...entry })); }
}
