// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which harness produced an arm or a result. Arms made by the opencode adapter carry runtime 'opencode' and
// their results carry harness 'opencode'; every other arm, and results written before the field existed
// (harness 'none' or 'kiro-cli-v2'), belong to kiro-cli.
const runtimeOf = (armOrResult) => (armOrResult?.runtime === 'opencode' || armOrResult?.harness === 'opencode' ? 'opencode' : 'kiro-cli');

module.exports = { runtimeOf };
