// SPDX-License-Identifier: Apache-2.0
// The judge system prompt every backend that sets one uses, and its hash. Its own file so a judge-backend plugin reads
// it through the SDK (`require('../../sdk').judgePrompt`) without loading the backend registry.
'use strict';

const crypto = require('node:crypto');

const JUDGE_SYSTEM_PROMPT = 'You are an evaluator. Reply only with the JSON object the user asks for.';
const systemPromptSha256 = () => crypto.createHash('sha256').update(JUDGE_SYSTEM_PROMPT).digest('hex');

module.exports = { JUDGE_SYSTEM_PROMPT, systemPromptSha256 };
