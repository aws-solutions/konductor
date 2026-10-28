// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  AppPortError,
  DEFAULT_APP_PORT,
  DEFAULT_PORT,
  appPort,
  originOf,
  portOf,
  stubPort,
} from './address.ts';

describe('stubPort', () => {
  it('is the default port when STUB_PORT is unset or empty', () => {
    expect(stubPort({})).toBe(DEFAULT_PORT);
    expect(stubPort({ STUB_PORT: '' })).toBe(DEFAULT_PORT);
  });

  it.each([
    ['1', 1],
    ['80', 80],
    ['6000', 6000],
    ['65535', 65535],
  ])('reads STUB_PORT=%s as %i', (value, port) => {
    expect(stubPort({ STUB_PORT: value })).toBe(port);
  });
});

describe('appPort', () => {
  it('is 4173 when WC_APP_PORT is unset or empty', () => {
    expect(DEFAULT_APP_PORT).toBe(4173);
    expect(appPort({})).toBe(4173);
    expect(appPort({ WC_APP_PORT: '' })).toBe(4173);
  });

  it('reads WC_APP_PORT', () => {
    expect(appPort({ WC_APP_PORT: '4300' })).toBe(4300);
  });

  it.each(['0', '65536', 'abc', '80x', '-1', '4173.5'])(
    'refuses WC_APP_PORT=%s and names the variable',
    (value) => {
      const attempt = () => appPort({ WC_APP_PORT: value });
      expect(attempt).toThrow(AppPortError);
      expect(attempt).toThrow(/WC_APP_PORT/);
    },
  );
});

describe('originOf', () => {
  it('names the port, except the default port of http', () => {
    expect(originOf(5174)).toBe('http://127.0.0.1:5174');
    expect(originOf(80)).toBe('http://127.0.0.1');
  });
});

describe('portOf', () => {
  it.each([
    ['http://127.0.0.1:5174', 5174],
    ['http://127.0.0.1', 80],
    ['http://127.0.0.1:80', 80],
    ['https://api.example.test', 443],
    ['https://api.example.test:8443', 8443],
  ])('reads %s as port %i', (origin, port) => {
    expect(portOf(origin)).toBe(port);
  });
});
