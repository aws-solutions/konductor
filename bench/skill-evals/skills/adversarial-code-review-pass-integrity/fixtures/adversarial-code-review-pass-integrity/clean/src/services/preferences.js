const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../../src/lib/ddb');

// Each user owns exactly one preferences item and only that user writes it.
async function savePreferences(userId, prefs) {
  const { Attributes } = await docClient.send(
    new PutCommand({
      TableName: process.env.PREFS_TABLE,
      Item: { userId, ...prefs, updatedAt: Date.now() },
      ReturnValues: 'ALL_OLD',
    }),
  );
  return { previous: Attributes ?? null };
}

module.exports = { savePreferences };
