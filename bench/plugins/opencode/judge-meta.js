// SPDX-License-Identifier: Apache-2.0
'use strict';

// The opencode judge backend's descriptor (a `judge-backend` part of this plugin, B-014). `maxPromptBytes`: opencode
// reads the prompt from stdin, so its cap is far above the kiro backend's one-argument limit.
module.exports = Object.freeze({ id: 'opencode', costUnit: 'usd', label: 'opencode on Bedrock, spend in USD', maxPromptBytes: 400000 });
