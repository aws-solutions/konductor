let sequence = 0;

export function makeId(prefix) {
  sequence += 1;
  return `${prefix}_${sequence.toString(36)}`;
}
