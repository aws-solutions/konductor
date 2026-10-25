// SPDX-License-Identifier: Apache-2.0
/**
 * Vitest setup file. Unmounts rendered trees after each test, because Testing
 * Library only does this on its own when test globals are enabled, and adds
 * the two browser APIs that the graph library needs and jsdom lacks.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IdentityMatrix {
  m22 = 1;
}

globalThis.ResizeObserver ??= NoopResizeObserver;
globalThis.DOMMatrixReadOnly ??=
  IdentityMatrix as unknown as typeof DOMMatrixReadOnly;

afterEach(() => {
  cleanup();
});
