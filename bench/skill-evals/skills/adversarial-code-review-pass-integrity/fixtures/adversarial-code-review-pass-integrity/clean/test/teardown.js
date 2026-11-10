const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../src/lib/ddb');

// Removes fixture rows after the integration suite.
async function clearRefunds(ids) {
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [process.env.REFUNDS_TABLE]: ids.map((refundId) => ({ DeleteRequest: { Key: { refundId } } })),
      },
    }),
  );
}

module.exports = { clearRefunds };
