const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../src/lib/ddb');

// Seeds fixture accounts before each integration test run.
async function seedAccounts() {
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [process.env.ACCOUNTS_TABLE]: [
          { PutRequest: { Item: { accountId: 'acct-1', balance: 1000 } } },
          { PutRequest: { Item: { accountId: 'acct-2', balance: 0 } } },
        ],
      },
    }),
  );
}

module.exports = { seedAccounts };
