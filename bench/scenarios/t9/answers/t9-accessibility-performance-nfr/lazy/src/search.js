// Search with a short wait after the last keystroke.
export function createSearch({ orders, delayMs = 200, schedule = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); }, onResults }) {
  let text = '';
  let ticket = 0;

  function run() {
    const words = text.toLowerCase().split(' ').filter(Boolean);
    onResults(orders.filter((o) => {
      const hay = [o.id, o.customer, o.city, ...(o.items || []).map((i) => i.name)].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    }));
  }

  return {
    setQuery(value) {
      text = value;
      const mine = ++ticket;
      schedule(() => { if (mine === ticket) run(); }, delayMs);
    },
    submit() {
      ticket += 1;
      run();
    },
  };
}
