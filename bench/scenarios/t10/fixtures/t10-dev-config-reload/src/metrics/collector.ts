export function counter() {
  let value = 0;
  return { add(amount = 1) { value += amount; }, read() { return value; } };
}
