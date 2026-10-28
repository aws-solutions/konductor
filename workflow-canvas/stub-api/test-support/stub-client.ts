// SPDX-License-Identifier: Apache-2.0
import { request, type IncomingHttpHeaders } from 'node:http';

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  /** The parsed JSON body, or `undefined` if there was none. */
  body: unknown;
}

export interface CallOptions {
  body?: unknown;
  /** A body sent as it is, for text that is not JSON. */
  rawBody?: string | Buffer;
  /** Replaces a default header; `undefined` removes it. */
  headers?: Record<string, string | undefined>;
}

/**
 * Calls the stub like a well-behaved client, with the server's own `Origin`,
 * a JSON content type and the bearer token. A test may override each per call.
 */
export class StubClient {
  token: string | undefined;
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  get(path: string, options?: CallOptions): Promise<Reply> {
    return this.call('GET', path, options);
  }

  put(path: string, body: unknown, options?: CallOptions): Promise<Reply> {
    return this.call('PUT', path, { ...options, body });
  }

  post(path: string, body: unknown, options?: CallOptions): Promise<Reply> {
    return this.call('POST', path, { ...options, body });
  }

  call(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<Reply> {
    const payload =
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body));
    const headers = {
      ...this.defaultHeaders(method),
      ...options.headers,
    };
    const defined = Object.entries(headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: this.port,
          method,
          path,
          headers: Object.fromEntries(defined),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const body = text === '' ? undefined : JSON.parse(text);
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            });
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  private defaultHeaders(method: string): Record<string, string | undefined> {
    const withBody = method !== 'GET';
    return {
      origin: withBody ? `http://127.0.0.1:${this.port}` : undefined,
      'content-type': withBody ? 'application/json' : undefined,
      authorization: this.token ? `Bearer ${this.token}` : undefined,
    };
  }
}
