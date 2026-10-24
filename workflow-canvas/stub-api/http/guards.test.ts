// SPDX-License-Identifier: Apache-2.0
/** Checks the rules that apply to every call: headers, bodies and routing. */
import { describe, expect, it } from 'vitest';
import { expectError } from '../test-support/contract.ts';
import { LAUNCH_CODE, useStub } from '../test-support/harness.ts';
import { MAX_BODY_BYTES } from './body.ts';

const WORKFLOW = '/api/workflow';
const VALIDATE = '/api/validate';

describe('the Host header', () => {
  const stub = useStub();

  it.each([
    ['another name', () => 'example.test'],
    ['the right name and another port', () => '127.0.0.1:1'],
    ['no port', () => '127.0.0.1'],
  ])('is refused with %s', async (_, host) => {
    const reply = await stub().client.get(WORKFLOW, {
      headers: { host: host() },
    });
    expectError(reply, 403, 'forbidden_host');
  });

  it('may be localhost with the right port', async () => {
    const { client, stub: running } = stub();
    const reply = await client.get(WORKFLOW, {
      headers: { host: `localhost:${running.port}` },
    });
    expect(reply.status).toBe(200);
  });

  it('is checked before the token', async () => {
    const { client } = stub();
    client.token = undefined;
    const reply = await client.get(WORKFLOW, {
      headers: { host: 'example.test' },
    });
    expectError(reply, 403, 'forbidden_host');
  });
});

describe('the Origin header', () => {
  const stub = useStub();
  const text = { text: 'x' };

  it('is required on a POST and a PUT', async () => {
    const { client } = stub();
    const headers = { origin: undefined };
    expectError(
      await client.post(VALIDATE, text, { headers }),
      403,
      'forbidden_origin',
    );
    const save = { text: 'x', base_hash: null };
    expectError(
      await client.put(WORKFLOW, save, { headers }),
      403,
      'forbidden_origin',
    );
  });

  it('must be the server itself on a POST', async () => {
    const headers = { origin: 'http://example.test' };
    const reply = await stub().client.post(VALIDATE, text, { headers });
    expectError(reply, 403, 'forbidden_origin');
  });

  it('may be left out of a GET', async () => {
    expect((await stub().client.get(WORKFLOW)).status).toBe(200);
  });

  it('must not point elsewhere on a GET', async () => {
    const headers = { origin: 'http://example.test' };
    expectError(
      await stub().client.get(WORKFLOW, { headers }),
      403,
      'forbidden_origin',
    );
  });

  it.each([
    ['cross-site', 403],
    ['same-site', 403],
    ['same-origin', 200],
    ['none', 200],
  ])('Sec-Fetch-Site %s on a GET is %i', async (site, status) => {
    const reply = await stub().client.get(WORKFLOW, {
      headers: { 'sec-fetch-site': site },
    });
    expect(reply.status).toBe(status);
    if (status === 403)
      expect(reply.body).toMatchObject({ code: 'forbidden_origin' });
  });

  it('is checked before the token', async () => {
    const { client } = stub();
    client.token = undefined;
    const headers = { origin: 'http://example.test' };
    expectError(
      await client.post(VALIDATE, text, { headers }),
      403,
      'forbidden_origin',
    );
  });
});

describe('the body', () => {
  const stub = useStub();

  it.each([
    ['text/plain', 'text/plain'],
    ['no content type', undefined],
    ['JSON in another charset', 'application/json; charset=latin1'],
    ['a look-alike media type', 'application/jsonp'],
  ])('is a bad request with %s', async (_, type) => {
    const reply = await stub().client.post(
      VALIDATE,
      { text: 'x' },
      {
        headers: { 'content-type': type },
      },
    );
    expectError(reply, 400, 'bad_request');
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON;charset=UTF-8',
  ])('may have the content type %s', async (type) => {
    const reply = await stub().client.post(
      VALIDATE,
      { text: 'x' },
      {
        headers: { 'content-type': type },
      },
    );
    expect(reply.status).toBe(200);
  });

  it.each([
    ['text that is not JSON', '{"text": '],
    ['an empty body', ''],
    ['a byte order mark', '\uFEFF{"text":"x"}'],
    ['a field the contract does not name', '{"text":"x","extra":1}'],
    ['the wrong type', '{"text":5}'],
    ['JSON that is not an object', '"x"'],
  ])('is a bad request with %s', async (_, rawBody) => {
    expectError(
      await stub().client.post(VALIDATE, undefined, { rawBody }),
      400,
      'bad_request',
    );
  });

  it('is a bad request when it is not UTF-8', async () => {
    const rawBody = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    expectError(
      await stub().client.post(VALIDATE, undefined, { rawBody }),
      400,
      'bad_request',
    );
  });

  it('is too large over 1 MiB, though the text alone is within its limit', async () => {
    const rawBody = JSON.stringify({
      text: 'x',
      pad: 'y'.repeat(MAX_BODY_BYTES),
    });
    expectError(
      await stub().client.post(VALIDATE, undefined, { rawBody }),
      413,
      'too_large',
    );
  });

  it('may be exactly 1 MiB', async () => {
    const head = '{"text":"x","name":"';
    const pad = 'a'.repeat(MAX_BODY_BYTES - head.length - 2);
    const rawBody = `${head}${pad}"}`;
    expect(rawBody.length).toBe(MAX_BODY_BYTES);
    expectError(
      await stub().client.post(VALIDATE, undefined, { rawBody }),
      400,
      'bad_name',
    );
  });

  it('is too large when the workflow text is over 256 KiB of UTF-8', async () => {
    const limit = 262_144;
    const fits = await stub().client.post(VALIDATE, {
      text: '#'.repeat(limit),
    });
    expect(fits.status).toBe(200);
    const bytes = await stub().client.post(VALIDATE, {
      text: '€'.repeat(limit / 3 + 1),
    });
    expectError(bytes, 413, 'too_large');
  });

  it('is judged by size before its shape', async () => {
    const rawBody = JSON.stringify({ pad: 'y'.repeat(MAX_BODY_BYTES) });
    expectError(
      await stub().client.post(VALIDATE, undefined, { rawBody }),
      413,
      'too_large',
    );
  });
});

describe('the order of checks', () => {
  const stub = useStub();

  it('puts the token before the content type', async () => {
    const { client } = stub();
    client.token = undefined;
    const reply = await client.post(
      VALIDATE,
      { text: 'x' },
      {
        headers: { 'content-type': 'text/plain' },
      },
    );
    expectError(reply, 401, 'unauthorized');
  });

  it('puts the content type before the body size', async () => {
    const rawBody = 'x'.repeat(MAX_BODY_BYTES + 1);
    const reply = await stub().client.post(VALIDATE, undefined, {
      rawBody,
      headers: { 'content-type': 'text/plain' },
    });
    expectError(reply, 400, 'bad_request');
  });
});

describe('paths and methods', () => {
  const stub = useStub({}, false);

  it('answers an unknown path with 404', async () => {
    expectError(await stub().client.get('/api/nothing'), 404, 'not_found');
    expectError(await stub().client.get('/'), 404, 'not_found');
    expectError(await stub().client.get('/api/workflow/'), 404, 'not_found');
  });

  it('answers a method the path does not list with 405 and an Allow header', async () => {
    const { client } = stub();
    const cases: [string, string, string][] = [
      ['DELETE', WORKFLOW, 'GET, PUT'],
      ['GET', VALIDATE, 'POST'],
      ['POST', '/api/runs/20261024-0412-00001', 'GET'],
      ['OPTIONS', '/api/session', 'POST'],
      ['HEAD', WORKFLOW, 'GET, PUT'],
    ];
    for (const [method, path, allow] of cases) {
      const reply = await client.call(method, path);
      expect(reply.status, `${method} ${path}`).toBe(405);
      expect(reply.headers.allow).toBe(allow);
      if (method !== 'HEAD')
        expect(reply.body).toMatchObject({ code: 'method_not_allowed' });
    }
  });

  it('answers 405 before it asks for a token', async () => {
    expect((await stub().client.call('DELETE', WORKFLOW)).status).toBe(405);
  });

  it('sets no cookie and sends no CORS headers', async () => {
    const reply = await stub().client.post('/api/session', {
      code: LAUNCH_CODE,
    });
    expect(
      Object.keys(reply.headers).filter((h) =>
        /^access-control-|^set-cookie$/.test(h),
      ),
    ).toEqual([]);
  });
});
