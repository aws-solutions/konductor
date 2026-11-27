// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plan-call parser lives in runner/lib/plan-call.js, because the runner writes its fields into result.json and the
// runner may not import from report/. Report code reads it from here.
module.exports = require('../runner/lib/plan-call.js');
