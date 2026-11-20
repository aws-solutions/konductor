import { DEFAULT_PREFIX } from './constants.js';
import { normalize } from './normalize.js';

export function format(value, options = {}) {
  const text = normalize(value);
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  return `${prefix} ${options.upper ? text.toUpperCase() : text}`;
}
