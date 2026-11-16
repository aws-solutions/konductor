// SPDX-License-Identifier: Apache-2.0
/**
 * Short-lived AWS credentials for one subject launch.
 *
 * Before every subject launch the parent runs `aws configure export-credentials --profile <name> --format process`
 * and reads the three values it prints: access key id, secret key and session token. Only those three reach the
 * child (subject-isolation.js subjectEnv). The child never sees the profile, a credential file or the SSO token
 * cache. A fresh export runs before every launch, so a refreshed session is always what the child gets.
 *
 * Long-term keys (no session token) are refused: a leak of a long-term key does not expire. Values are kept in
 * memory only and never written to a file, a log or an error message. The `aws` command's own output is never
 * quoted in an error, because it holds the secret; its stderr is redacted first.
 *
 * Near expiry (assertFresh): a launch is not started within `marginMs` of the credentials' expiry, 3 minutes by
 * default. The subject runner passes its call timeout when that is longer, so the credentials outlast the call. The
 * run stops instead of starting a call that could fail half way.
 */
'use strict';

const proc = require('./proc');
const { childEnv } = require('./child-env');
const { redact } = require('./redact');

const EXPORT_TIMEOUT_MS = 60000;
/** No launch starts this close to the expiry of its credentials. */
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;
// A profile name as the AWS CLI accepts it, and never one that could be read as a flag.
const PROFILE_NAME = /^[A-Za-z0-9_.@+=,][A-Za-z0-9_.@+=,-]{0,127}$/;
const ERROR_CHARS = 400;

/** AWS credentials are missing, refused, long-term or near expiry. Fatal: the run stops, finished work is kept. */
class CredentialError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialError';
    this.fatal = true;
  }
}

/**
 * The AWS profile the benchmark uses: `aws_profile` from the settings, else AWS_PROFILE from the environment.
 * Throws CredentialError when neither names one, or the name is not a plain profile name.
 */
function resolveProfile(config, baseEnv = process.env) {
  const profile =
    (config && config.aws_profile) || (baseEnv && baseEnv.AWS_PROFILE) || null;
  if (!profile)
    throw new CredentialError(
      'no AWS profile is named: set aws_profile in bench/config.json or AWS_PROFILE in the environment',
    );
  if (!PROFILE_NAME.test(profile))
    throw new CredentialError(
      `the AWS profile name ${JSON.stringify(String(profile).slice(0, 40))} is not a plain profile name`,
    );
  return profile;
}

const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/**
 * Runs `aws configure export-credentials` for `profile` and returns
 *   { accessKeyId, secretAccessKey, sessionToken, expiration }
 * where `expiration` is an ISO time or null when the CLI reports none. Throws CredentialError when the command
 * fails, prints something that is not the expected JSON, or returns long-term keys.
 * `run`, `bin` and `baseEnv` exist for tests.
 */
async function exportCredentials({
  profile,
  region,
  run = proc.run,
  bin = 'aws',
  baseEnv = process.env,
  timeoutMs = EXPORT_TIMEOUT_MS,
} = {}) {
  if (typeof profile !== 'string' || !PROFILE_NAME.test(profile))
    throw new CredentialError(
      'exportCredentials: profile must be a plain AWS profile name',
    );
  // The aws command itself reads the profile: it gets the parent's environment with every other credential
  // source removed (child-env.js), so a stray key in the parent shell cannot stand in for the profile.
  const result = await run(
    bin,
    [
      'configure',
      'export-credentials',
      '--profile',
      profile,
      '--format',
      'process',
    ],
    { env: childEnv({ profile, region, base: baseEnv }), timeoutMs },
  );
  if (result.code !== 0 || result.timedOut || result.overflow)
    throw new CredentialError(
      `could not load credentials for profile ${profile}: ${
        result.timedOut
          ? 'aws configure export-credentials timed out'
          : `exit ${result.code}: ${redact(result.stderr, { maxChars: ERROR_CHARS })}`
      }`,
    );
  let exported;
  try {
    exported = JSON.parse(result.stdout);
  } catch {
    exported = null;
  }
  if (
    !exported ||
    typeof exported !== 'object' ||
    !nonEmptyString(exported.AccessKeyId) ||
    !nonEmptyString(exported.SecretAccessKey)
  )
    throw new CredentialError(
      `could not load credentials for profile ${profile}: aws configure export-credentials did not print the expected JSON`,
    );
  if (!nonEmptyString(exported.SessionToken))
    throw new CredentialError(
      `profile ${profile} gave long-term keys (no session token); the subject only gets short-lived credentials, so use a profile that assumes a role or signs in with SSO`,
    );
  const expiration =
    exported.Expiration === undefined || exported.Expiration === null
      ? null
      : String(exported.Expiration);
  return {
    accessKeyId: exported.AccessKeyId,
    secretAccessKey: exported.SecretAccessKey,
    sessionToken: exported.SessionToken,
    expiration,
  };
}

/**
 * Throws CredentialError when `credentials.expiration` is less than `marginMs` away, or cannot be read.
 * Credentials with no expiration pass: nothing says when they end.
 */
function assertFresh(
  credentials,
  { now = Date.now, marginMs = EXPIRY_MARGIN_MS, label = '' } = {},
) {
  const expiration = credentials && credentials.expiration;
  if (expiration === null || expiration === undefined) return;
  const expiresAt = Date.parse(expiration);
  if (!Number.isFinite(expiresAt))
    throw new CredentialError(
      `the exported credentials have an expiration that cannot be read: ${JSON.stringify(String(expiration).slice(0, 40))}`,
    );
  if (expiresAt - now() < marginMs)
    throw new CredentialError(
      `the AWS credentials expire at ${new Date(expiresAt).toISOString()}, less than ${Math.round(marginMs / 60000)} minutes away, so ${label || 'the call'} was not started; refresh the session and rerun (finished work is kept)`,
    );
}

module.exports = {
  EXPIRY_MARGIN_MS,
  CredentialError,
  resolveProfile,
  exportCredentials,
  assertFresh,
};
