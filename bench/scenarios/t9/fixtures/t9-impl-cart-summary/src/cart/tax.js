import { roundHalfAwayFromZero } from './money.js';

export function taxAmount(baseMinor, rate = 0) {
  return roundHalfAwayFromZero(baseMinor * Number(rate));
}
