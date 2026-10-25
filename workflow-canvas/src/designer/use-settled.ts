// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';

/**
 * The value a promise settles with, or `undefined` until it does. The promise
 * is made outside React, so a repeated effect (as in strict mode) does not
 * start the work twice. The promise must not reject.
 */
export function useSettled<T>(promise: Promise<T>): T | undefined {
  const [settled, setSettled] = useState<{ of: Promise<T>; value: T }>();

  useEffect(() => {
    let current = true;
    void promise.then((value) => {
      if (current) setSettled({ of: promise, value });
    });
    return () => {
      current = false;
    };
  }, [promise]);

  return settled?.of === promise ? settled.value : undefined;
}
