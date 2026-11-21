import { matchesQuery } from './match.js';

// Debounced text search over a fixed list of orders. It has no DOM access.
//
//   const search = createSearch({ orders, delayMs: 200, schedule, onResults });
//   search.setQuery('jose');   // runs once, delayMs after the last call
//   search.submit();           // runs now with the latest text (Enter)
//
// schedule(fn, ms) must return a function that cancels the call. onResults
// receives the array of every order that matches, not a page of it.

const defaultSchedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function createSearch({ orders, delayMs = 200, schedule = defaultSchedule, onResults }) {
  let latest = '';
  let cancelPending = null;

  function dropPending() {
    if (cancelPending) {
      cancelPending();
      cancelPending = null;
    }
  }

  function run() {
    cancelPending = null;
    onResults(orders.filter((order) => matchesQuery(order, latest)));
  }

  return {
    setQuery(text) {
      latest = String(text ?? '');
      dropPending();
      cancelPending = schedule(run, delayMs);
    },
    submit() {
      dropPending();
      run();
    },
  };
}
