const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/ddb');

const TABLE = process.env.ACCOUNTS_TABLE;

async function transferFunds(fromId, toId, amount) {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { accountId: fromId },
      UpdateExpression: 'SET balance = balance - :amt',
      ConditionExpression: 'balance >= :amt',
      ExpressionAttributeValues: { ':amt': amount },
    }),
  );

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { accountId: toId },
      UpdateExpression: 'SET balance = balance + :amt',
      ExpressionAttributeValues: { ':amt': amount },
    }),
  );

  return { fromId, toId, amount };
}

module.exports = { transferFunds };
