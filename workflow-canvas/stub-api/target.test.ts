// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PORT, originOf, StubPortError } from './address.ts';
import {
  apiTarget,
  apiTargetOrExit,
  ApiTargetError,
  redact,
} from './target.ts';

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

  it('writes the default stub origin the way a browser does, for port 80', () => {
    expect(apiTarget({ STUB_PORT: '80' }).origin).toBe('http://127.0.0.1');
  });

  it('uses the default port for an empty STUB_PORT', () => {
    expect(apiTarget({ STUB_PORT: '' }).origin).toBe(originOf(DEFAULT_PORT));
  });

  it.each(['abc', '5174x', '-1', '0', '65536', '1.5', ' 80', '1e3'])(
    'refuses STUB_PORT=%s with a message that names it',
    (port) => {
      const attempt = () => apiTarget({ STUB_PORT: port });
      expect(attempt).toThrow(StubPortError);
      expect(attempt).toThrow('STUB_PORT');
    },
  );

  it('ignores a bad STUB_PORT when a target is set', () => {
    const env = { WC_API_TARGET: 'http://127.0.0.1:8080', STUB_PORT: 'abc' };
    expect(apiTarget(env).origin).toBe('http://127.0.0.1:8080');
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

describe('the message of a refused target', () => {
  const message = (value: string): string => {
    try {
      apiTarget({ WC_API_TARGET: value });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  };

  it.each([
    'http://user:secret@127.0.0.1:8080',
    'http://:secret@127.0.0.1:8080',
    'user:secret@127.0.0.1:8080',
    'http://127.0.0.1:8080/?token=secret',
    'http://127.0.0.1:8080/#secret',
    '  http://user:secret@127.0.0.1:8080',
    'http://user:secret@127.0.0.1:8080  ',
    'http://user:sec/ret@127.0.0.1:8080',
    'http://user:sec#ret@127.0.0.1:8080',
    'http://user:sec?ret@127.0.0.1:8080',
    'user:sec/ret@127.0.0.1:8080',
    'http://127.0.0.1:8080/?k=a@secret',
    'http://127.0.0.1:8080/#a@secret',
    'http://u:x@secret/more@h:1',
    'http://u:p@ss/word@h:1',
  ])('does not repeat the secret in %s', (value) => {
    expect(message(value)).not.toContain('secret');
  });

  it('still shows the part that helps', () => {
    expect(message('http://user:secret@127.0.0.1:8080')).toContain(
      'http://***@127.0.0.1:8080',
    );
  });

  it.each([
    ['http://u:p@h:1', 'http://***@h:1'],
    ['u:p@h:1', '***@h:1'],
    ['http://h:1/a?x=1#y', 'http://h:1/a?...'],
    ['  http://u:p@h:1  ', 'http://***@h:1'],
    ['http://u:p@ss@h:1', 'http://***@h:1'],
    ['http://u:p@h:1/a?k=x@y', 'http://***@h:1/a?...'],
    // An `@` only after the authority ends: it may be a password with a
    // `/`, `#` or `?`, or an `@` in the query, so all of it is masked.
    ['http://u:p/q@h:1', 'http://***'],
    ['http://u:p#q@h:1', 'http://***'],
    ['http://u:p?q@h:1', 'http://***'],
    ['user:sec/ret@h:1', '***'],
    ['http://h:1/?k=a@secret', 'http://***'],
    ['http://h:1/#a@secret', 'http://***'],
    ['http://h:1/p@q', 'http://***'],
    // A password with both an `@` and a `/`: the first `@` is not the end of
    // the userinfo, so the text after it may be secret.
    ['http://u:x@secret/more@h:1', 'http://***'],
    ['http://u:p@ss/word@h:1', 'http://***'],
    ['HTTP://u:p@h:1', 'HTTP://***@h:1'],
    ['http://h:1', 'http://h:1'],
    ['nope', 'nope'],
  ])('redacts %s to %s', (value, shown) => {
    expect(redact(value)).toBe(shown);
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

  it('prints one line and exits with 1 for a bad STUB_PORT', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit called');
    }) as never);
    const print = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => apiTargetOrExit({ STUB_PORT: 'abc' })).toThrow('exit called');

    expect(exit).toHaveBeenCalledWith(1);
    const [message] = print.mock.calls[0] as [string];
    expect(message).toMatch(/^error: STUB_PORT="abc" is not usable: [^\n]*$/);
  });
});
