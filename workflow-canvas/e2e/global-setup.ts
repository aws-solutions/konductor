// SPDX-License-Identifier: Apache-2.0
import { openSharedSession } from './support/session';

/** Opens the one session that the tests share; see `openSharedSession`. */
export default async function globalSetup(): Promise<void> {
  await openSharedSession();
}
