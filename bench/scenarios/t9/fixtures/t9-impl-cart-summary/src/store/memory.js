export function createMemoryStore(initial = {}) {
  let state = { ...initial };
  return {
    read() { return { ...state }; },
    update(patch) { state = { ...state, ...patch }; return { ...state }; },
    clear() { state = {}; }
  };
}
