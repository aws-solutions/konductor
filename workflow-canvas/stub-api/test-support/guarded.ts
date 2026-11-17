// SPDX-License-Identifier: Apache-2.0
import { expect } from 'vitest';
import { expectError } from './contract.ts';
import type { TestStub } from './harness.ts';

/**
 * Checks that a GET path refuses a call with no token, a foreign `Host` or a
 * foreign `Origin`, and a method it does not list, as every route does.
 */
export async function expectGuardedGet(
  { client, stub }: TestStub,
  path: string,
): Promise<void> {
  const noToken = await client.get(path, {
    headers: { authorization: undefined },
  });
  expectError(noToken, 401, 'unauthorized');

  const foreignHost = await client.get(path, {
    headers: { host: `example.com:${stub.port}` },
  });
  expectError(foreignHost, 403, 'forbidden_host');

  const foreignOrigin = await client.get(path, {
    headers: { origin: 'http://example.com' },
  });
  expectError(foreignOrigin, 403, 'forbidden_origin');

  const post = await client.post(path, {});
  expectError(post, 405, 'method_not_allowed');
  expect(post.headers['allow']).toBe('GET');
}
