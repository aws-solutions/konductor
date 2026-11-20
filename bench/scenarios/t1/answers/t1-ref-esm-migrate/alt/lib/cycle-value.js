import { value as a } from './cycle-a.js';
import { value as b } from './cycle-b.js';

export function cycleValue() {
  return `${a()}-${b()}`;
}
