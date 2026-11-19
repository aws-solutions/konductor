import { healthResponse } from './health.js';
import { receiveWebhook } from './webhooks/receiver.js';
import { notify } from './notify/callback.js';
import { nextId } from './util/ids.js';

export async function route(request, context) {
  if (request.method === 'GET' && request.path === '/healthz') return healthResponse();
  const match = request.path.match(/^\/hooks\/(source|billing)$/);
  if (!match || request.method !== 'POST') return { status: 404, body: { error: 'not found' } };
  const result = receiveWebhook({ ...request, provider: match[1], secret: context.config.webhookSecret, logger: context.logger });
  if (result.event) {
    result.event.id ||= nextId();
    context.store.add(result.event);
    await notify(context.config.notifyUrl, result.event, context.config.notifyTimeoutMs, context.logger);
  }
  return { status: result.status, body: result.body || { accepted: true } };
}
