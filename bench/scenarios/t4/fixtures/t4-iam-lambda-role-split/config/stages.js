'use strict';

const ACCOUNT_ID = '111122223333';
const REGIONS = { staging: 'us-east-1', prod: 'us-west-2' };

function resources(stage) {
  if (!Object.prototype.hasOwnProperty.call(REGIONS, stage)) throw new Error(`unknown stage: ${stage}`);
  const region = REGIONS[stage];
  const db = (name) => `arn:aws:dynamodb:${region}:${ACCOUNT_ID}:table/${stage}-${name}`;
  const index = (table, name) => `${db(table)}/index/${name}`;
  const queue = (name) => `arn:aws:sqs:${region}:${ACCOUNT_ID}:${stage}-${name}`;
  const bucket = (name) => `arn:aws:s3:::lantern-${stage}-${name}-${ACCOUNT_ID}`;
  const secret = (name) => `arn:aws:secretsmanager:${region}:${ACCOUNT_ID}:secret:${stage}/${name}-abc123`;
  const logGroup = (name) => `arn:aws:logs:${region}:${ACCOUNT_ID}:log-group:/aws/lambda/${stage}-${name}:*`;
  return {
    createOrder: { table: db('orders'), logGroup: logGroup('create-order') },
    paymentWebhook: {
      secret: secret('payment-webhook'),
      table: db('payments'),
      queue: queue('fulfilment'),
      logGroup: logGroup('payment-webhook'),
    },
    fulfilmentWorker: {
      queue: queue('fulfilment'),
      deadLetterQueue: queue('fulfilment-dlq'),
      table: db('shipments'),
      logGroup: logGroup('fulfilment-worker'),
    },
    nightlyReport: {
      table: db('report-orders'),
      index: index('report-orders', 'by-status'),
      bucket: bucket('reports'),
      logGroup: logGroup('nightly-report'),
    },
    adminExport: {
      table: db('customers'),
      bucket: bucket('exports'),
      logGroup: logGroup('admin-export'),
    },
    legacy: {
      table: db('legacy-data'),
      queue: queue('legacy-events'),
      bucket: bucket('legacy-files'),
      secret: secret('legacy-service'),
      logGroup: logGroup('legacy-runner'),
    },
  };
}

module.exports = { ACCOUNT_ID, REGIONS, resources };
