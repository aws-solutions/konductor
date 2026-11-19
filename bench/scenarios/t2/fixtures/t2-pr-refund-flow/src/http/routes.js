import { readJson } from './body.js';
import { merchantFrom } from './auth.js';
import { route } from './router.js';
import { captureOrder } from '../orders/capture.js';
import { refundOrder } from '../refunds/service.js';

export function routes({ store }) {
  return [
    route('POST', '/v1/orders/:orderId/capture', async ({ request, params }) => {
      const body = await readJson(request);
      const order = captureOrder({
        store,
        merchantId: merchantFrom(request),
        orderId: params.orderId,
        amountMinor: body.amountMinor
      });
      return { status: 200, body: order };
    }),
    route('POST', '/v1/orders/:orderId/refund', async ({ request, params }) => {
      const body = await readJson(request);
      const refund = await refundOrder({
        store,
        merchantId: merchantFrom(request),
        orderId: params.orderId,
        amount: body.amount,
        card: body.card,
        customerEmail: body.customerEmail
      });
      return { status: 201, body: refund };
    })
  ];
}
