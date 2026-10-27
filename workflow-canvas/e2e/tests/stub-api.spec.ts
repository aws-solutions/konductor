// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { API_TARGET, API_URL, STUB_LAUNCH_CODE } from '../../playwright.shared';

// Shows that a test can reach the API: the stub that the Playwright config
// starts, or the server named by `WC_API_TARGET`. No page calls it.
test('the API gives a session for the launch code of the config', async ({
  request,
}) => {
  const reply = await request.post(`${API_URL}/api/session`, {
    data: { code: STUB_LAUNCH_CODE },
    headers: { Origin: API_URL },
  });
  expect(reply.status()).toBe(200);
  expect(await reply.json()).toMatchObject({
    root: 'hello',
    harness: 'kiro-cli',
    api_version: 1,
  });
});

// A reload drops the token and the launch code from the page, so the person
// opens the printed address again. The stub of `dev:stub` and of these tests
// takes the code again. A server that follows the contract to the letter does
// not, so this test is for the stub only.
if (API_TARGET.isStub) {
  test('the stub takes the launch code again and gives the same session', async ({
    request,
  }) => {
    const trade = async () =>
      request.post(`${API_URL}/api/session`, {
        data: { code: STUB_LAUNCH_CODE },
        headers: { Origin: API_URL },
      });

    const first = await trade();
    const again = await trade();

    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual(await first.json());
  });
}
