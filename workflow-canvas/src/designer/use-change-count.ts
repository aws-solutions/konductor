// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';

/** How many times `value` has been replaced by another value, by identity. */
export function useChangeCount(value: unknown): number {
  const [seen, setSeen] = useState({ value, count: 0 });
  if (seen.value === value) return seen.count;
  const next = { value, count: seen.count + 1 };
  setSeen(next);
  return next.count;
}
