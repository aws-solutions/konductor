import { value as otherValue } from './cycle-a.js';

export function value() { return 'cycle-b'; }
export const partner = otherValue;
