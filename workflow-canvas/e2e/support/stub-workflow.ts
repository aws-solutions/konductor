// SPDX-License-Identifier: Apache-2.0
import type { APIRequestContext } from '@playwright/test';
import { SAMPLE_FILES } from '../../stub-api/core/sample.ts';
import { API_URL } from '../../playwright.shared';
import { sharedSession } from './session';

/** The text the stub starts with. */
export const SAMPLE_TEXT = SAMPLE_FILES.hello ?? '';

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${sharedSession().token}`,
    Origin: API_URL,
    ...extra,
  };
}

/** The workflow as the API holds it now. */
export async function currentWorkflow(
  request: APIRequestContext,
): Promise<{ text: string; hash: string }> {
  const reply = await request.get(`${API_URL}/api/workflow`, {
    headers: headers(),
  });
  return (await reply.json()) as { text: string; hash: string };
}

/**
 * Writes `text` over the workflow as another program would, in the middle of
 * a test, so a save from the page finds the file changed.
 */
export async function overwriteWorkflow(
  request: APIRequestContext,
  text: string,
): Promise<void> {
  const { hash } = await currentWorkflow(request);
  const reply = await request.put(`${API_URL}/api/workflow`, {
    headers: headers({ 'Content-Type': 'application/json' }),
    data: { text, base_hash: hash },
  });
  if (!reply.ok()) {
    throw new Error(
      `The stub refused to write the workflow (${reply.status()}).`,
    );
  }
}

/**
 * Puts the stub's workflow back as it started. The editing tests save for real
 * and the stub keeps what is saved until it stops, so each one starts and ends
 * from the sample.
 */
export async function restoreSample(request: APIRequestContext): Promise<void> {
  const { text } = await currentWorkflow(request);
  if (text !== SAMPLE_TEXT) await overwriteWorkflow(request, SAMPLE_TEXT);
}
