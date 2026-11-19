import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handleNotify } from '../src/handlers/notify.js';

describe('Notification handler', () => {
  const originalSecret = process.env.NOTIFY_SECRET;
  
  beforeEach(() => {
    process.env.NOTIFY_SECRET = 'test_notify_secret_789';
    // Mock fetch globally
    global.fetch = async (url, options) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ received: true }),
        headers: new Map([['content-type', 'application/json']])
      };
    };
  });
  
  afterEach(() => {
    process.env.NOTIFY_SECRET = originalSecret;
    delete global.fetch;
  });
  
  it('forwards notification to provided URL', async () => {
    const req = {
      body: {
        url: 'https://api.customer.com/webhook',
        payload: { event: 'test', data: { id: 123 } },
        secret: 'test_notify_secret_789'
      }
    };
    
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };
    
    await handleNotify(req, res);
    
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.forwarded, true);
  });
  
  it('rejects invalid secret', async () => {
    const req = {
      body: {
        url: 'https://api.customer.com/webhook',
        payload: { event: 'test' },
        secret: 'wrong_secret'
      }
    };
    
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };
    
    await handleNotify(req, res);
    
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error, 'Invalid secret');
  });
  
  it('requires all fields', async () => {
    const req = {
      body: {
        url: 'https://api.customer.com/webhook',
        // Missing payload and secret
      }
    };
    
    const res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };
    
    await handleNotify(req, res);
    
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'Missing required fields: url, payload, secret');
  });
});