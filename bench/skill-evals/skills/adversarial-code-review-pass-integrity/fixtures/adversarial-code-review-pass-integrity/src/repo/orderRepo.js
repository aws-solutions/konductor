const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { docClient } = require('../lib/ddb');

const ORDERS = process.env.ORDERS_TABLE;
const AUDIT = process.env.AUDIT_TABLE;

async function updateOrderStatus(orderId, status) {
  const { Item: order } = await docClient.send(
    new GetCommand({ TableName: ORDERS, Key: { orderId } }),
  );
  const updated = { ...order, status, version: order.version + 1 };
  await docClient.send(new PutCommand({ TableName: ORDERS, Item: updated }));
  const { Item: fresh } = await docClient.send(
    new GetCommand({ TableName: ORDERS, Key: { orderId } }),
  );
  return fresh;
}

async function appendAudit(orderId, event) {
  await docClient.send(
    new PutCommand({
      TableName: AUDIT,
      Item: { auditId: randomUUID(), orderId, event, at: Date.now() },
      ConditionExpression: 'attribute_not_exists(auditId)',
    }),
  );
}

module.exports = { updateOrderStatus, appendAudit };
