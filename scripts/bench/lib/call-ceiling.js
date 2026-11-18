// SPDX-License-Identifier: Apache-2.0
/**
 * What one OpenCode call (a judge call or a checklist writer call) reserves in the spend ledger, and the output limit
 * it is given. They live apart from the client (opencode.js, which starts processes) so that `plan`, which must never
 * load a module that spawns one, can compare the reservation with the p90 it sums.
 */
'use strict';

const { reservationFor } = require('./ledger');
const { defaultProfile, tokenPrices } = require('./cost-profile');

// The token estimate of a prompt for the reservation: its bytes over 3 (a token is at least 3 bytes in the stored
// judge calls, so this is not low) plus what OpenCode adds around it (its own system prompt), 4000 tokens, a little
// above the smallest call in the paid runs measured (1810 to 4061 input tokens with a prompt of a few words).
const BYTES_PER_TOKEN_ESTIMATE = 3;
const OPENCODE_INPUT_OVERHEAD_TOKENS = 4000;

/**
 * The output limit of one call: the entry of `seat` in config.judge_max_output_tokens_by_seat, else (for a seat in
 * models.judges with no entry) judge_max_output_tokens. With no judge seat given, the first seat whose model is
 * `modelId` decides in the same way. A checklist writer model that no seat uses gets the largest of
 * judge_max_output_tokens and every by-seat entry, so a reply is never cut shorter than the longest any seat may give.
 * loadConfig has checked both settings, so this only reads them.
 */
function judgeMaxOutputTokens(config, { seat, modelId } = {}) {
  const base = config.judge_max_output_tokens;
  if (typeof base !== 'number')
    throw new TypeError(
      'judgeCall: config.judge_max_output_tokens is required (loadConfig)',
    );
  const bySeat = config.judge_max_output_tokens_by_seat || {};
  const judges = config.models?.judges || {};
  const ofSeat = (name) => (Object.hasOwn(bySeat, name) ? bySeat[name] : base);
  if (seat !== undefined && Object.hasOwn(bySeat, seat)) return bySeat[seat];
  if (seat !== undefined && Object.hasOwn(judges, seat)) return base;
  const owner = Object.keys(judges).find((name) => judges[name] === modelId);
  return owner === undefined
    ? Math.max(base, ...Object.values(bySeat))
    : ofSeat(owner);
}

/**
 * What one call reserves in the ledger, its ceiling: the tokens of the prompt (its bytes over 3, plus
 * OpenCode's own overhead) at the model's input price and `maxOutputTokens` at its output price, both from the cost
 * profile, rounded up to a millionth of a dollar. No reply can run past `maxOutputTokens`, so no call can cost more.
 * A model with no prices in the profile is reserved at its p90, as before, with `ceiling` false. The call's kind,
 * model, mean and cliReportsLow options are those of reservationFor.
 */
function callCeiling({
  config,
  callKind,
  modelId,
  prompt,
  maxOutputTokens,
  costProfile,
}) {
  const base = reservationFor(config, callKind, modelId, costProfile);
  const prices = tokenPrices(
    costProfile ?? defaultProfile(),
    callKind,
    modelId,
  );
  if (!prices) return { ...base, ceiling: false };
  const inputTokens =
    Math.ceil(Buffer.byteLength(prompt, 'utf8') / BYTES_PER_TOKEN_ESTIMATE) +
    OPENCODE_INPUT_OVERHEAD_TOKENS;
  // Tokens times USD per million tokens is millionths of a dollar.
  const micros =
    inputTokens * prices.inputUsdPerMTok +
    maxOutputTokens * prices.outputUsdPerMTok;
  return { ...base, usd: Math.ceil(micros) / 1e6, ceiling: true };
}

module.exports = {
  BYTES_PER_TOKEN_ESTIMATE,
  OPENCODE_INPUT_OVERHEAD_TOKENS,
  judgeMaxOutputTokens,
  callCeiling,
};
