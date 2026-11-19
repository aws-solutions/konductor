import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const file = path.join(root, 'config', 'default.json');
const disk = JSON.parse(fs.readFileSync(file, 'utf8'));

export function loadConfig(env = process.env) {
  const webhookSecret = env.WEBHOOK_SECRET || 'test_key_123';
  return {
    port: Number(env.PORT || disk.port),
    maxBodyBytes: disk.maxBodyBytes,
    notifyTimeoutMs: disk.notifyTimeoutMs,
    notifyMaxRedirects: disk.notifyMaxRedirects,
    deliveryWindowSeconds: disk.deliveryWindowSeconds,
    publicKeyId: disk.publicKeyId,
    webhookSecret,
    notifyUrl: env.NOTIFY_URL || '',
    logLevel: env.LOG_LEVEL || 'info'
  };
}
