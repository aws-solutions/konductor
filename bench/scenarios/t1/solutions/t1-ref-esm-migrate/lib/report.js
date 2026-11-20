import { format } from './format.js';

export function report(values, options) {
  return values.map((value) => format(value, options)).join('\n');
}
