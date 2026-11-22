import { earnHandler } from './routes-earn.js';
import { redeemHandler } from './routes-redeem.js';
import { inspectBalance } from './routes-admin.js';

export const handlers = Object.freeze({ earnHandler, redeemHandler, inspectBalance });

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('points-counter handlers ready');
}
