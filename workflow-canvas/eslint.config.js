// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: 'error',
    },
  },
  {
    // Type information lets no-floating-promises catch a missing `await` on a
    // Playwright call or assertion, which would otherwise pass vacuously.
    files: ['e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    // Playwright's rules include no fixed waits (no-wait-for-timeout) and the
    // missing-await check for assertions.
    ...playwright.configs['flat/recommended'],
    files: ['e2e/**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      // Helpers named expect* wrap assertions, e.g. expectTabShown.
      'playwright/expect-expect': [
        'error',
        { assertFunctionPatterns: ['^expect[A-Z]'] },
      ],
    },
  },
  {
    // The capture tests save PNGs and assert nothing.
    files: ['e2e/capture/**/*.ts'],
    rules: { 'playwright/expect-expect': 'off' },
  },
);
