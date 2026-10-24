// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { STUB_LAUNCH_CODE, STUB_URL } from '../../playwright.shared';

// Shows that the Playwright config starts the stub and that a test can reach
// it. No page calls the stub.
test('the stub API gives a session for the launch code of the config', async ({
  request,
}) => {
  const reply = await request.post(`${STUB_URL}/api/session`, {
    data: { code: STUB_LAUNCH_CODE },
    headers: { Origin: STUB_URL },
  });
  expect(reply.status()).toBe(200);
  expect(await reply.json()).toMatchObject({
    root: 'hello',
    harness: 'kiro-cli',
    api_version: 1,
  });
});
