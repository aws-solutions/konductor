// SPDX-License-Identifier: Apache-2.0

/** What opening another workflow would take from the page. */
export interface SwapLoss {
  /** The Designer holds changes that are not saved. */
  draft: boolean;
  /** A run is being followed. */
  run: boolean;
}

/** The latest `SwapLoss`, kept where code outside React can read it. */
export interface SwapRisk {
  get(): SwapLoss;
  set(loss: SwapLoss): void;
}

/** A risk that starts with nothing to lose. */
export function createSwapRisk(): SwapRisk {
  let loss: SwapLoss = { draft: false, run: false };
  return {
    get: () => loss,
    set: (next) => {
      loss = next;
    },
  };
}

/** The question to ask before the loss, or `undefined` when there is none. */
export function swapWarning({ draft, run }: SwapLoss): string | undefined {
  const losses = [
    draft && 'drops your unsaved changes',
    run && 'stops following the run in progress, which goes on at its server',
  ].filter(Boolean);
  if (losses.length === 0) return undefined;
  return `Opening this launch address ${losses.join(' and ')}. Cancel keeps this page as it is; paste the address again to open it.`;
}

/**
 * Wraps `offer` so that a code which would cost the page something is first
 * confirmed. A code that is not confirmed is dropped, and the page stays.
 */
export function guardOffers(
  risk: SwapRisk,
  confirm: (question: string) => boolean,
  offer: (code: string) => void,
): (code: string) => void {
  return (code) => {
    const question = swapWarning(risk.get());
    if (question === undefined || confirm(question)) offer(code);
  };
}
