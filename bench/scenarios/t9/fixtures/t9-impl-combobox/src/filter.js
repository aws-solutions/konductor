function plain(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }

function rank(query, items) {
  const needle = plain(query).trim();
  if (!needle) return [];
  return items
    .map((item, position) => ({ item, position, label: plain(item.name) }))
    .filter(({ label }) => label.includes(needle))
    .sort((left, right) => {
      const leftPrefix = left.label.startsWith(needle) ? 0 : 1;
      const rightPrefix = right.label.startsWith(needle) ? 0 : 1;
      return leftPrefix - rightPrefix || left.position - right.position;
    })
    .map(({ item }) => item);
}

function normalizeForSearch(value) { return plain(value); }
if (typeof module !== 'undefined') module.exports = { rank, normalizeForSearch };
if (typeof globalThis !== 'undefined') globalThis.harborRank = rank;
