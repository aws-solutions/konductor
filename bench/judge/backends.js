// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('node:crypto');

// Which program asks the judge model. `kiro` is the default and the only one that existed before; `opencode` calls
// the model on Amazon Bedrock through `opencode run` with the tools off and a one-line system prompt.
const BACKENDS = ['kiro', 'opencode'];
const DEFAULT_BACKEND = 'kiro';

const JUDGE_SYSTEM_PROMPT = 'You are an evaluator. Reply only with the JSON object the user asks for.';
const systemPromptSha256 = () => crypto.createHash('sha256').update(JUDGE_SYSTEM_PROMPT).digest('hex');

// Panel ids stay the logical names used everywhere else (family checks run on them). `temperature: null` means the
// model rejects the field on Bedrock, so the no-temperature agent is used and nothing is sent.
// `limit` is opencode's context and output cap for the model; the output cap is far above the longest reply seen.
const OPENCODE_MODELS = {
  'gpt-5.6-luna': { bedrockId: 'global.openai.gpt-5.6-luna', temperature: null, limit: { context: 900000, output: 8000 } },
  'deepseek-3.2': { bedrockId: 'deepseek.v3.2', temperature: 0, limit: { context: 160000, output: 8000 } },
  'glm-5': { bedrockId: 'zai.glm-5', temperature: 0, limit: { context: 200000, output: 8000 } },
  'qwen3-coder-next': { bedrockId: 'qwen.qwen3-coder-next', temperature: 0, limit: { context: 200000, output: 8000 } },
  'minimax-m2.5': { bedrockId: 'minimax.minimax-m2.5', temperature: 0, limit: { context: 200000, output: 8000 } },
};

const known = () => Object.keys(OPENCODE_MODELS).join(', ');

function opencodeModel(logical) {
  const m = OPENCODE_MODELS[logical];
  if (!m) throw new Error(`no Bedrock mapping for judge "${logical}" on the opencode backend (known panel ids: ${known()})`);
  return { logical, ...m, agent: m.temperature === null ? 'judge-notemp' : 'judge' };
}

// A raw Bedrock id would pass the family check under another family name (zai.glm-5 is "zai", glm-5 is "glm").
function checkOpencodeJudges(judges) {
  for (const j of judges) {
    const logical = Object.keys(OPENCODE_MODELS).find((k) => OPENCODE_MODELS[k].bedrockId === j);
    if (logical) throw new Error(`judge "${j}" is a Bedrock model id; use the panel id "${logical}" (the backend maps it)`);
    opencodeModel(j);
  }
}

module.exports = { BACKENDS, DEFAULT_BACKEND, JUDGE_SYSTEM_PROMPT, systemPromptSha256, OPENCODE_MODELS, opencodeModel, checkOpencodeJudges };
