// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '../core/clock.ts';
import { ApiError } from '../core/errors.ts';
import { newSecret, sameSecret } from './system.ts';

/** How long the launch code works, from the moment the stub listens. */
export const LAUNCH_WINDOW_MS = 60_000;

export interface SessionGateOptions {
  clock: Clock;
  launchCode: string;
  /**
   * For a dev flow that reloads the page: the launch code works again, with
   * no time limit, and gives the token it gave the first time. A reload
   * drops the token from the page, and the address it was read from.
   */
  reusableLaunchCode?: boolean;
}

/**
 * The only login of the stub: a one-time launch code is traded for a bearer
 * token. This is a local development stub and keeps no real credentials.
 */
export class SessionGate {
  private readonly clock: Clock;
  private readonly launchCode: string;
  private readonly reusable: boolean;
  private expiresAt = 0;
  private token: string | undefined;

  constructor(options: SessionGateOptions) {
    this.clock = options.clock;
    this.launchCode = options.launchCode;
    this.reusable = options.reusableLaunchCode === true;
  }

  /** Starts the launch window: call it as the stub hands out the code. */
  openWindow(): void {
    this.expiresAt = this.clock.now() + LAUNCH_WINDOW_MS;
  }

  /**
   * Trades the launch code for the token. The code works once, unless the
   * gate is reusable: then it works any time and gives the same token.
   */
  exchange(code: string): string {
    const right = sameSecret(code, this.launchCode);
    if (!right || !this.isOpen()) {
      throw new ApiError('invalid_code', 'The launch code is not valid.');
    }
    this.token ??= newSecret();
    return this.token;
  }

  private isOpen(): boolean {
    if (this.reusable) return true;
    return this.token === undefined && this.clock.now() < this.expiresAt;
  }

  /** Refuses a call whose `Authorization` header is not the session token. */
  authorize(header: string | undefined): void {
    const sent = /^Bearer (\S+)$/i.exec(header ?? '')?.[1];
    if (
      this.token === undefined ||
      sent === undefined ||
      !sameSecret(sent, this.token)
    ) {
      throw new ApiError(
        'unauthorized',
        'The session token is missing or wrong.',
      );
    }
  }
}
