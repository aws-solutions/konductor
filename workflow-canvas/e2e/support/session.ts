// SPDX-License-Identifier: Apache-2.0
import { API_URL, STUB_LAUNCH_CODE } from '../../playwright.shared';

const SESSION_ENV = 'WC_E2E_SESSION';

/** The reply of `POST /api/session`. */
export interface SessionReply {
  token: string;
  root: string;
  harness: string;
  api_version: number;
}

/**
 * Trades the launch code of the config for a session. The code works once, so
 * this runs once per run, in the global setup, and every test shares the
 * result through `sharedSession`.
 */
export async function openSharedSession(): Promise<void> {
  const reply = await fetch(`${API_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API_URL },
    body: JSON.stringify({ code: STUB_LAUNCH_CODE }),
  });
  if (!reply.ok) {
    throw new Error(
      `The API refused the launch code of the config (${reply.status}). ` +
        'A launch code works once and for 60 seconds: restart the server.',
    );
  }
  process.env[SESSION_ENV] = JSON.stringify(await reply.json());
}

/** The session that the global setup opened. */
export function sharedSession(): SessionReply {
  const stored = process.env[SESSION_ENV];
  if (!stored) throw new Error('The global setup did not open a session.');
  return JSON.parse(stored) as SessionReply;
}
