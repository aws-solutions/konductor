export function makeDeliveryStore() {
  const rows = [];
  return {
    add(row) { rows.push({ ...row }); },
    all() { return rows.map((row) => ({ ...row })); },
    has(id) { return rows.some((row) => row.id === id); }
  };
}
