// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PORT, originOf } from './address.ts';
import { apiTarget, apiTargetOrExit, ApiTargetError } from './target.ts';

describe('apiTarget', () => {
  it('defaults to the stub on its default port', () => {
    expect(apiTarget({})).toEqual({
      origin: originOf(DEFAULT_PORT),
      isStub: true,
    });
  });

  it('follows STUB_PORT for the default stub', () => {
    expect(apiTarget({ STUB_PORT: '6000' })).toEqual({
      origin: originOf(6000),
      isStub: true,
    });
  });

  it('treats an empty value as unset', () => {
    expect(apiTarget({ WC_API_TARGET: '' }).isStub).toBe(true);
  });

  it.each([
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['http://localhost:9000/', 'http://localhost:9000'],
    ['https://api.example.test', 'https://api.example.test'],
    ['http://api.example.test:80', 'http://api.example.test'],
  ])('takes %s as the origin %s, and not the stub', (value, origin) => {
    expect(apiTarget({ WC_API_TARGET: value })).toEqual({
      origin,
      isStub: false,
    });
  });

  it('ignores STUB_PORT when a target is set', () => {
    const env = { WC_API_TARGET: 'http://127.0.0.1:8080', STUB_PORT: '6000' };
    expect(apiTarget(env).origin).toBe('http://127.0.0.1:8080');
  });

  it.each([
    ['not a url', 'not a URL'],
    ['127.0.0.1:8080', 'not a URL'],
    ['localhost:8080', 'scheme must be http or https'],
    ['ftp://127.0.0.1:21', 'scheme must be http or https'],
    ['http://127.0.0.1:8080/api', 'no path'],
    ['http://127.0.0.1:8080?x=1', 'no path'],
    ['http://127.0.0.1:8080/#top', 'no path'],
    ['http://user:secret@127.0.0.1:8080', 'credentials'],
  ])('refuses %s', (value, reason) => {
    const attempt = () => apiTarget({ WC_API_TARGET: value });
    expect(attempt).toThrow(ApiTargetError);
    expect(attempt).toThrow(reason);
    expect(attempt).toThrow('WC_API_TARGET');
  });
});

describe('apiTargetOrExit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a good target without exiting', () => {
    const exit = vi.spyOn(process, 'exit');
    expect(apiTargetOrExit({}).isStub).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints one line and exits with 1 for a bad value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit called');
    }) as never);
    const print = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => apiTargetOrExit({ WC_API_TARGET: 'nope' })).toThrow(
      'exit called',
    );

    expect(exit).toHaveBeenCalledWith(1);
    const [message] = print.mock.calls[0] as [string];
    expect(message).toContain('WC_API_TARGET="nope" is not usable');
    expect(message).not.toMatch(/\n\s+at /);
  });
});
