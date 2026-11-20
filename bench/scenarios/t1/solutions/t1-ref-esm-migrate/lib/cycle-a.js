import { value as otherValue } from './cycle-b.js';

export function value() { return 'cycle-a'; }
export const partner = otherValue;
