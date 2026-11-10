'use strict';

const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../lib/ddb');
const { toHttpError } = require('../lib/errors');

async function get(req, res) {
  try {
    const out = await doc.send(new GetCommand({ TableName: 'accounts', Key: { accountId: req.params.accountId } }));
    if (!out.Item) return res.status(404).json({ message: 'Not found' });
    return res.json(out.Item);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return res.status(status).json(body);
  }
}

async function create(req, res) {
  try {
    const item = { accountId: req.body.accountId, balance: 0, version: 1 };
    await doc.send(new PutCommand({ TableName: 'accounts', Item: item, ConditionExpression: 'attribute_not_exists(accountId)' }));
    return res.status(201).json(item);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return res.status(status).json(body);
  }
}

module.exports = { get, create };
