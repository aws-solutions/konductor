// SPDX-License-Identifier: Apache-2.0
'use strict';

// The AWS credential variables a Claude Code run takes from the environment, and the check that they are there. Split
// out of claude-code.js (DEBT D-192).

const CREDENTIAL_VARS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
// With any of these set the AWS SDK ignores the exported keys and looks the profile up in the scratch HOME.
const PROFILE_VARS = ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE'];

/** Names (never values) of the credential variables present in `env`. */
const credentialNames = (env = process.env) => CREDENTIAL_VARS.filter((k) => env[k]);

/** Throws when the credentials a run needs are not in the caller's environment. Values never appear in the message. */
function checkCredentials(env = process.env) {
  const missing = CREDENTIAL_VARS.slice(0, 2).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Claude Code runs take AWS credentials from the environment; missing ${missing.join(', ')} (export them in the shell that starts the bench, for example from \`aws configure export-credentials --format env\`)`);
  if (/^ASIA/.test(env.AWS_ACCESS_KEY_ID) && !env.AWS_SESSION_TOKEN) throw new Error('AWS_ACCESS_KEY_ID is a temporary key (ASIA...) but AWS_SESSION_TOKEN is not set');
  const shadow = PROFILE_VARS.filter((k) => env[k]);
  return { shadow };
}

module.exports = { CREDENTIAL_VARS, PROFILE_VARS, credentialNames, checkCredentials };
