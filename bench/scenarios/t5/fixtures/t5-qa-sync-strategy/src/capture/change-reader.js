class ChangeReader {
  constructor(records = []) { this.records = records; }
  readAfter(sequence = 0, limit = Infinity) {
    return this.records.filter(record => record.sequence > sequence).slice(0, limit);
  }
}

module.exports = { ChangeReader };
