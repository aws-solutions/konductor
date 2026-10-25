// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { API_URL } from '../../playwright.shared';
import { sharedSession } from '../support/session';

// Shows that a test can reach the API: the stub that the Playwright config
// starts, or the server named by `WC_API_TARGET`. The launch code works once,
// so the global setup traded it for the session that these tests read.
test('the API gave a session for the launch code of the config', () => {
  expect(sharedSession()).toMatchObject({
    root: 'hello',
    harness: 'kiro-cli',
    api_version: 1,
  });
});

test('the token of that session loads the root workflow', async ({
  request,
}) => {
  const reply = await request.get(`${API_URL}/api/workflow`, {
    headers: { Authorization: `Bearer ${sharedSession().token}` },
  });

  expect(reply.status()).toBe(200);
  expect(await reply.json()).toMatchObject({
    name: 'hello',
    view: { stages: [{ name: 'draft' }, { name: 'review' }] },
  });
});
