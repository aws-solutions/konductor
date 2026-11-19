/**
 * ESLint configuration
 */

module.exports = {
  env: {
    es2022: true,
    node: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'prefer-const': 'warn',
    'no-var': 'error',
    'object-shorthand': 'warn',
    'quote-props': ['warn', 'as-needed'],
    'quotes': ['warn', 'single', { avoidEscape: true }],
    'semi': ['warn', 'always'],
    'comma-dangle': ['warn', 'never'],
    'arrow-parens': ['warn', 'always'],
    'no-trailing-spaces': 'warn',
    'eol-last': ['warn', 'always'],
    'indent': ['warn', 2, { SwitchCase: 1 }]
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/']
};