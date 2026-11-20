import { fold, searchableText } from './match.js';

// Debounced search over a fixed list of orders (no DOM here).
// The haystack of every order is built once, so a run only folds the query and scans.

const timeoutSchedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

class OrderSearch {
  constructor({ orders, delayMs, schedule, onResults }) {
    this.orders = orders;
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.onResults = onResults;
    this.haystacks = orders.map(searchableText);
    this.text = '';
    this.stop = null;
  }

  cancelWait() {
    const stop = this.stop;
    this.stop = null;
    if (typeof stop === 'function') stop();
  }

  matches() {
    const words = fold(this.text).split(/\s+/).filter(Boolean);
    if (!words.length) return this.orders.slice();
    return this.orders.filter((_, i) => words.every((w) => this.haystacks[i].includes(w)));
  }

  flush() {
    this.stop = null;
    this.onResults(this.matches());
  }

  setQuery(text) {
    this.text = text == null ? '' : String(text);
    this.cancelWait();
    this.stop = this.schedule(() => this.flush(), this.delayMs);
  }

  submit() {
    this.cancelWait();
    this.flush();
  }
}

export function createSearch({ orders, delayMs = 200, schedule = timeoutSchedule, onResults }) {
  const search = new OrderSearch({ orders, delayMs, schedule, onResults });
  return { setQuery: (t) => search.setQuery(t), submit: () => search.submit() };
}
