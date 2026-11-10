const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/ddb');

const TABLE = process.env.ACCOUNTS_TABLE;

// SQS-triggered Lambda. Failed messages are redelivered by SQS (maxReceiveCount 5).
exports.handler = async (event) => {
  for (const record of event.Records) {
    const { accountId, amount } = JSON.parse(record.body);
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { accountId },
        UpdateExpression: 'ADD balance :amt',
        ExpressionAttributeValues: { ':amt': amount },
      }),
    );
  }
};
