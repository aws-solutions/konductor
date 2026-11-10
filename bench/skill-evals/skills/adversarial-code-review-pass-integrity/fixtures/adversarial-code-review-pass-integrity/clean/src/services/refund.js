const { transactWrite } = require('../../../src/lib/tx');

const ACCOUNTS = process.env.ACCOUNTS_TABLE;
const REFUNDS = process.env.REFUNDS_TABLE;

// Moves money back to the customer and records the refund in one transaction.
async function refund(refundId, accountId, amount) {
  return transactWrite(
    [
      {
        Put: {
          TableName: REFUNDS,
          Item: { refundId, accountId, amount },
          ConditionExpression: 'attribute_not_exists(refundId)',
        },
      },
      {
        Update: {
          TableName: ACCOUNTS,
          Key: { accountId },
          UpdateExpression: 'SET balance = balance + :amt',
          ConditionExpression: 'attribute_exists(accountId)',
          ExpressionAttributeValues: { ':amt': amount },
        },
      },
    ],
    refundId,
  );
}

module.exports = { refund };
