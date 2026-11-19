import { paymentStatus } from './verify.js';

export function receivePayment(body) {
  return { ...body, paymentStatus: paymentStatus(body) };
}
