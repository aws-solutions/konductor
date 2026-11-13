// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runtimes the bench knows, in display order. Leaf module: it loads only the static descriptors, so runtime.js and
// arms.js can use it without a require cycle. harness/index.js checks that each harness module carries the same descriptor.
const DESCRIPTORS = Object.freeze([
  require('./kiro-meta.js'),
  require('./opencode-meta.js'),
  require('./claude-code-meta.js'),
]);

module.exports = { DESCRIPTORS };
