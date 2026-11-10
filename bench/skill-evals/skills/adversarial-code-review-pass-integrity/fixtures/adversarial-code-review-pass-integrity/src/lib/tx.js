const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./ddb');

// Wraps TransactWriteCommand so callers pass plain Put/Update/ConditionCheck items.
async function transactWrite(items, clientRequestToken) {
  return docClient.send(
    new TransactWriteCommand({ TransactItems: items, ClientRequestToken: clientRequestToken }),
  );
}

module.exports = { transactWrite };
