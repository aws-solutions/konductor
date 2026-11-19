import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isValidCallbackUrl } from '../src/utils/validation.js';

describe('URL validation', () => {
  it('accepts valid HTTPS URLs', () => {
    assert.strictEqual(isValidCallbackUrl('https://example.com/webhook'), true);
    assert.strictEqual(isValidCallbackUrl('https://api.service.com/callback'), true);
  });
  
  it('rejects internal network addresses', () => {
    assert.strictEqual(isValidCallbackUrl('http://10.0.0.1/webhook'), false);
    assert.strictEqual(isValidCallbackUrl('https://192.168.1.1/callback'), false);
    assert.strictEqual(isValidCallbackUrl('http://172.16.0.1/test'), false);
    assert.strictEqual(isValidCallbackUrl('http://127.0.0.1:3000/hook'), false);
  });
  
  it('rejects cloud metadata endpoint', () => {
    assert.strictEqual(isValidCallbackUrl('http://169.254.169.254/metadata'), false);
  });
  
  it('rejects invalid URLs', () => {
    assert.strictEqual(isValidCallbackUrl('not-a-url'), false);
    assert.strictEqual(isValidCallbackUrl(''), false);
  });
});