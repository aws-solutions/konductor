// SPDX-License-Identifier: Apache-2.0
/**
 * Environment for the child processes that talk to Bedrock.
 *
 * Why this exists: a child inherits the parent's whole environment. An ANTHROPIC_, OPENAI_, OPENCODE_ or
 * CLAUDE_CODE_ variable left in the parent would silently redirect the
 * call elsewhere or change how the CLI behaves, and NODE_OPTIONS, BASH_ENV or ENV would run code of the
 * parent's choosing inside the child. Those are always dropped. A Bedrock bearer token
 * (AWS_BEARER_TOKEN_*) counts as a credential: it passes through without a profile and is dropped with one.
 *
 * Without a profile (the judge path: OpenCode reads its credentials from the environment and its config
 * sets no profile), the parent's AWS credential variables pass through only when the caller gives no exported
 * credentials; with exported credentials the judge client removes them and sets the exported keys instead
 * (opencode.js judgeEnv). With a profile, every other credential source is removed and the child gets exactly
 * that profile.
 * Everything else (PATH, HOME, proxies, CA bundles) is kept.
 */
'use strict';

const ALWAYS_DROP =
  /^(ANTHROPIC_.*|OPENAI_.*|OPENCODE_.*|CLAUDE_CODE_.*|CLAUDECODE|NODE_OPTIONS|BASH_ENV|ENV)$/;
const CREDENTIAL_VARS =
  /^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_SECURITY_TOKEN|AWS_CREDENTIAL_EXPIRATION|AWS_BEARER_TOKEN_.*|AWS_ROLE_ARN|AWS_ROLE_SESSION_NAME|AWS_WEB_IDENTITY_TOKEN_FILE|AWS_CONTAINER_.*|AWS_PROFILE|AWS_DEFAULT_PROFILE)$/;

/**
 * @param {object} options
 * @param {string} [options.profile]  named AWS profile; when set, every other credential source is removed
 * @param {string} [options.region]
 * @param {object} [options.base]     source environment (default process.env)
 * @param {object} [options.extra]    variables to set last
 */
function childEnv({ profile, region, base = process.env, extra = {} } = {}) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || ALWAYS_DROP.test(name)) continue;
    if (profile && CREDENTIAL_VARS.test(name)) continue;
    env[name] = value;
  }
  if (profile) {
    env.AWS_PROFILE = profile;
    env.AWS_DEFAULT_PROFILE = profile;
    env.AWS_EC2_METADATA_DISABLED = 'true';
  }
  if (region) {
    env.AWS_REGION = region;
    env.AWS_DEFAULT_REGION = region;
  }
  return { ...env, ...extra };
}

module.exports = { childEnv, ALWAYS_DROP, CREDENTIAL_VARS };
