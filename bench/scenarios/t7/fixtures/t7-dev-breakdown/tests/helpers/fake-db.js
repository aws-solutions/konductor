function fakeDb(rows = []) { return { query: async () => ({ rows }) }; }
module.exports = { fakeDb };
