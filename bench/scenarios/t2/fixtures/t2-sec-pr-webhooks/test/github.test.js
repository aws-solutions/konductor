import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { verifyGitHubSignature } from '../src/handlers/github.js';

describe('GitHub webhook handler', () => {
  const secret = 'dev_default_secret_123'; // Must match default in env.js
  
  it('verifies valid signature', async () => {
    const payload = '{"event":"push","ref":"refs/heads/main"}';
    const crypto = await import('node:crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const signature = `sha256=${hmac.digest('hex')}`;
    
    const isValid = verifyGitHubSignature(payload, signature);
    assert.strictEqual(isValid, true);
  });
  
  it('rejects invalid signature', () => {
    const payload = '{"event":"push"}';
    // Need a valid hex string of correct length
    const signature = 'sha256=' + '0'.repeat(64);
    
    const isValid = verifyGitHubSignature(payload, signature);
    assert.strictEqual(isValid, false);
  });
  
  it('rejects malformed signature header', () => {
    const payload = 'test';
    
    assert.throws(() => {
      verifyGitHubSignature(payload, 'invalid-format');
    }, /Invalid signature format/);
  });
});