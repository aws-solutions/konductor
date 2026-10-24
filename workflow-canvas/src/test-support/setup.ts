// SPDX-License-Identifier: Apache-2.0
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver, which some Cloudscape components rely on.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;

afterEach(() => {
  cleanup();
});
