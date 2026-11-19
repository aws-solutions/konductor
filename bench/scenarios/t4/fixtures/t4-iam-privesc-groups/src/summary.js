'use strict';

function summarize(account, policyCount) {
  return {
    account: account.accountId,
    region: account.region,
    environment: account.environment,
    policies: policyCount,
    functions: account.functions.length,
    services: account.services.length
  };
}

function formatSummary(summary) {
  return [
    `Account: ${summary.account}`,
    `Region: ${summary.region}`,
    `Environment: ${summary.environment}`,
    `Policies: ${summary.policies}`,
    `Functions: ${summary.functions}`,
    `Services: ${summary.services}`
  ].join('\n');
}

module.exports = { summarize, formatSummary };
