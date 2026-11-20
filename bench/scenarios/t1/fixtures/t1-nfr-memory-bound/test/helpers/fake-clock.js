function fakeClock(start = 1000) {
  let value = start;
  return {
    now: () => value,
    advance: amount => { value += amount; },
    set: next => { value = next; }
  };
}

module.exports = { fakeClock };
