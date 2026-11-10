'use strict';

const { UpdateCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../lib/ddb');

async function create(req, res) {
  const { fromAccountId, toAccountId, amount } = req.body;
  console.info('transfer request', JSON.stringify(req.body));
  try {
    await doc.send(new UpdateCommand({
      TableName: 'accounts',
      Key: { accountId: fromAccountId },
      UpdateExpression: 'SET balance = balance - :amt',
      ExpressionAttributeValues: { ':amt': amount },
    }));
    await doc.send(new UpdateCommand({
      TableName: 'accounts',
      Key: { accountId: toAccountId },
      UpdateExpression: 'SET balance = balance + :amt',
      ExpressionAttributeValues: { ':amt': amount },
    }));
    const transfer = { accountId: fromAccountId, createdAt: Date.now(), toAccountId, amount, memo: req.body.details.memo };
    await doc.send(new PutCommand({ TableName: 'transfers', Item: transfer }));
    return res.status(201).json(transfer);
  } catch (err) {
    return res.status(500).json({ message: err.message, stack: err.stack });
  }
}

async function list(req, res) {
  const cursor = req.query.cursor
    ? JSON.parse(Buffer.from(req.query.cursor, 'base64').toString('utf8'))
    : undefined;
  const out = await doc.send(new QueryCommand({
    TableName: 'transfers',
    KeyConditionExpression: 'accountId = :a',
    ExpressionAttributeValues: { ':a': req.params.accountId },
    ExclusiveStartKey: cursor,
  }));
  return res.json({ items: out.Items, cursor: out.LastEvaluatedKey });
}

module.exports = { create, list };
