import { setPartner } from './cycle-a.js';

export function value() {
  return 'cycle-b';
}

setPartner(value);
