// SPDX-License-Identifier: Apache-2.0
'use strict';

// Moved to bench/core/load-run.js (FW-10); runner/lib/load-run.js binds it. Kept so report, cap, judge and kit
// callers keep working. shortcut: re-export for one release, then callers move to runner/lib/load-run.js.
module.exports = require('../runner/lib/load-run.js');
