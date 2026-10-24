// SPDX-License-Identifier: Apache-2.0
/**
 * Vitest setup file. Unmounts rendered trees after each test, because Testing
 * Library only does this on its own when test globals are enabled.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
