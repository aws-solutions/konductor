const bundledRecords = require('../data/records.json');

function createPagedSource(pages) {
  if (!Array.isArray(pages)) throw new TypeError('pages must be an array');
  let index = 0;
  let closed = false;
  let count = 0;
  return {
    async fetchPage() {
      if (closed) return null;
      if (index >= pages.length) return null;
      const page = pages[index++];
      count += 1;
      return Array.isArray(page) ? page : [];
    },
    close() { closed = true; },
    get pagesFetched() { return count; },
    get closed() { return closed; }
  };
}

const defaultSource = createPagedSource([bundledRecords]);

module.exports = { createPagedSource, defaultSource };
