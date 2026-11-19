'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAllowed } = require('./iam-eval');

const root = path.join(__dirname, '..');
const role = (name) => JSON.parse(fs.readFileSync(path.join(root, 'infra', 'roles', name), 'utf8'));
const target = {
  monitoring: 'arn:aws:iam::111122223333:role/MonitoringVendorAccess',
  backup: 'arn:aws:iam::111122223333:role/BackupVendorAccess',
  partner: 'arn:aws:iam::111122223333:role/PartnerCiAccess',
  deploy: 'arn:aws:iam::111122223333:role/CrossAccountDeploy'
};
const principals = {
  monitoring: 'arn:aws:iam::222233334444:role/TelemetryReader',
  backup: 'arn:aws:iam::333344445555:role/VaultBackupVendor',
  partner: 'arn:aws:iam::444455556666:role/BuildReleaseRole',
  deploy: 'arn:aws:iam::555566667777:role/DeploymentAutomation'
};
const external = {
  monitoring: 'monitoring-ext-8d21',
  backup: 'backup-ext-19c2',
  partner: 'partner-ext-42b7'
};

function request(action, resource, principal, context = {}) {
  return { action, resource, principal, context };
}
function check(name, policy, req, expected) {
  test(name, () => assert.equal(isAllowed([role(policy)], req), expected));
}

const trustAllows = [
  ['monitoring accepts its documented runner', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, { AWS: principals.monitoring }, { 'sts:ExternalId': external.monitoring })],
  ['backup accepts its documented runner', 'backup-trust.json', request('sts:AssumeRole', target.backup, { AWS: principals.backup }, { 'sts:ExternalId': external.backup })],
  ['partner CI accepts its documented runner', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: principals.partner }, { 'sts:ExternalId': external.partner })],
  ['deployment role accepts an in-organization runner', 'deploy-trust.json', request('sts:AssumeRole', target.deploy, { AWS: principals.deploy }, { 'aws:PrincipalOrgID': 'o-exampleorgid' })],
  ['deployment role accepts a tagged session', 'deploy-trust.json', request('sts:TagSession', target.deploy, { AWS: principals.deploy }, { 'aws:PrincipalOrgID': 'o-exampleorgid', 'aws:TagKeys': ['release'] })]
];
trustAllows.forEach(([name, policy, req]) => check(name, policy, req, true));

const metricResources = [
  'arn:aws:cloudwatch:us-east-1:111122223333:alarm:api-latency',
  'arn:aws:cloudwatch:us-west-2:111122223333:alarm:worker-errors',
  'arn:aws:cloudwatch:us-east-1:111122223333:alarm:queue-depth'
];
for (const action of ['cloudwatch:GetMetricData', 'cloudwatch:GetMetricStatistics', 'cloudwatch:ListMetrics']) {
  for (const resource of metricResources) {
    check(`monitoring allows ${action} on ${resource}`, 'monitoring-permissions.json', request(action, resource), true);
  }
}
const logResources = [
  'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api:*',
  'arn:aws:logs:us-west-2:111122223333:log-group:/northstar/worker:*',
  'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/batch:*'
];
for (const action of ['logs:DescribeLogGroups', 'logs:DescribeLogStreams', 'logs:FilterLogEvents', 'logs:GetLogEvents', 'logs:StartQuery', 'logs:GetQueryResults']) {
  for (const resource of logResources) {
    check(`monitoring allows ${action} on ${resource}`, 'monitoring-permissions.json', request(action, resource), true);
  }
}

const trustDenies = [
  ['monitoring rejects another account', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, { AWS: 'arn:aws:iam::999900001111:role/TelemetryReader' }, { 'sts:ExternalId': external.monitoring })],
  ['monitoring rejects another role in its account', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, { AWS: 'arn:aws:iam::222233334444:role/OtherRole' }, { 'sts:ExternalId': external.monitoring })],
  ['monitoring rejects a wrong external id', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, { AWS: principals.monitoring }, { 'sts:ExternalId': 'monitoring-ext-wrong' })],
  ['monitoring rejects a missing external id', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, { AWS: principals.monitoring })],
  ['monitoring rejects an anonymous caller', 'monitoring-trust.json', request('sts:AssumeRole', target.monitoring, {}, { 'sts:ExternalId': external.monitoring })],
  ['monitoring rejects a non-assume action', 'monitoring-trust.json', request('sts:TagSession', target.monitoring, { AWS: principals.monitoring }, { 'sts:ExternalId': external.monitoring })],
  ['backup rejects another role in its account', 'backup-trust.json', request('sts:AssumeRole', target.backup, { AWS: 'arn:aws:iam::333344445555:role/OtherRole' }, { 'sts:ExternalId': external.backup })],
  ['backup rejects another account', 'backup-trust.json', request('sts:AssumeRole', target.backup, { AWS: 'arn:aws:iam::999900001111:role/VaultBackupVendor' }, { 'sts:ExternalId': external.backup })],
  ['backup rejects a wrong external id', 'backup-trust.json', request('sts:AssumeRole', target.backup, { AWS: principals.backup }, { 'sts:ExternalId': 'backup-ext-wrong' })],
  ['backup rejects a missing external id', 'backup-trust.json', request('sts:AssumeRole', target.backup, { AWS: principals.backup })],
  ['backup rejects an anonymous caller', 'backup-trust.json', request('sts:AssumeRole', target.backup, {}, { 'sts:ExternalId': external.backup })],
  ['partner rejects another role in its account', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: 'arn:aws:iam::444455556666:role/OtherRole' }, { 'sts:ExternalId': external.partner })],
  ['partner rejects its account root', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: 'arn:aws:iam::444455556666:root' }, { 'sts:ExternalId': external.partner })],
  ['partner rejects another account', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: 'arn:aws:iam::999900001111:role/BuildReleaseRole' }, { 'sts:ExternalId': external.partner })],
  ['partner rejects a wrong external id', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: principals.partner }, { 'sts:ExternalId': 'partner-ext-wrong' })],
  ['partner rejects a missing external id', 'partner-ci-trust.json', request('sts:AssumeRole', target.partner, { AWS: principals.partner })],
  ['deployment rejects a caller outside the organization', 'deploy-trust.json', request('sts:AssumeRole', target.deploy, { AWS: principals.deploy }, { 'aws:PrincipalOrgID': 'o-outsider' })],
  ['deployment rejects a missing organization id', 'deploy-trust.json', request('sts:AssumeRole', target.deploy, { AWS: principals.deploy })],
  ['deployment rejects another role in its account', 'deploy-trust.json', request('sts:AssumeRole', target.deploy, { AWS: 'arn:aws:iam::555566667777:role/OtherRole' }, { 'aws:PrincipalOrgID': 'o-exampleorgid' })],
  ['deployment rejects another account in the organization', 'deploy-trust.json', request('sts:AssumeRole', target.deploy, { AWS: 'arn:aws:iam::999900001111:role/DeploymentAutomation' }, { 'aws:PrincipalOrgID': 'o-exampleorgid' })],
  ['deployment rejects source identity permission', 'deploy-trust.json', request('sts:SetSourceIdentity', target.deploy, { AWS: principals.deploy }, { 'aws:PrincipalOrgID': 'o-exampleorgid' })],
  ['deployment rejects tagging from outside the organization', 'deploy-trust.json', request('sts:TagSession', target.deploy, { AWS: principals.deploy }, { 'aws:PrincipalOrgID': 'o-outsider' })]
];
trustDenies.forEach(([name, policy, req]) => check(name, policy, req, false));

const monitoringDenies = [
  ['monitoring cannot read a secret', 'secretsmanager:GetSecretValue', 'arn:aws:secretsmanager:us-east-1:111122223333:secret:dashboard-token'],
  ['monitoring cannot list secrets', 'secretsmanager:ListSecrets', 'arn:aws:secretsmanager:us-east-1:111122223333:secret:dashboard-token'],
  ['monitoring cannot put metric data', 'cloudwatch:PutMetricData', 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:api-latency'],
  ['monitoring cannot delete an alarm', 'cloudwatch:DeleteAlarms', 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:api-latency'],
  ['monitoring cannot enable an alarm', 'cloudwatch:EnableAlarmActions', 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:api-latency'],
  ['monitoring cannot write log events', 'logs:PutLogEvents', 'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api:log-stream/one'],
  ['monitoring cannot create a log group', 'logs:CreateLogGroup', 'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api'],
  ['monitoring cannot delete a log group', 'logs:DeleteLogGroup', 'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api'],
  ['monitoring cannot change log retention', 'logs:PutRetentionPolicy', 'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api'],
  ['monitoring cannot read an object', 's3:GetObject', 'arn:aws:s3:::northstar-example-artifacts/build.zip'],
  ['monitoring cannot list a bucket', 's3:ListBucket', 'arn:aws:s3:::northstar-example-artifacts'],
  ['monitoring cannot describe instances', 'ec2:DescribeInstances', 'arn:aws:ec2:us-east-1:111122223333:instance/i-example123'],
  ['monitoring cannot invoke a function', 'lambda:InvokeFunction', 'arn:aws:lambda:us-east-1:111122223333:function:release-hook'],
  ['monitoring cannot decrypt a key', 'kms:Decrypt', 'arn:aws:kms:us-east-1:111122223333:key/example-key'],
  ['monitoring cannot assume another role', 'sts:AssumeRole', 'arn:aws:iam::111122223333:role/OtherRole'],
  ['monitoring cannot pass a role', 'iam:PassRole', 'arn:aws:iam::111122223333:role/OtherRole'],
  ['monitoring cannot start an instance', 'ec2:StartInstances', 'arn:aws:ec2:us-east-1:111122223333:instance/i-example123'],
  ['monitoring cannot publish an event', 'events:PutEvents', 'arn:aws:events:us-east-1:111122223333:event-bus/default'],
  ['monitoring cannot update a stack', 'cloudformation:UpdateStack', 'arn:aws:cloudformation:us-east-1:111122223333:stack/example/example-id'],
  ['monitoring cannot write a parameter', 'ssm:PutParameter', 'arn:aws:ssm:us-east-1:111122223333:parameter/example'],
  ['monitoring cannot create a snapshot', 'ec2:CreateSnapshot', 'arn:aws:ec2:us-east-1:111122223333:volume/vol-example123'],
  ['monitoring cannot modify a security group', 'ec2:AuthorizeSecurityGroupIngress', 'arn:aws:ec2:us-east-1:111122223333:security-group/sg-example123'],
  ['monitoring cannot delete a database', 'rds:DeleteDBInstance', 'arn:aws:rds:us-east-1:111122223333:db:example'],
  ['monitoring cannot send a queue message', 'sqs:SendMessage', 'arn:aws:sqs:us-east-1:111122223333:events'],
  ['monitoring cannot publish to a topic', 'sns:Publish', 'arn:aws:sns:us-east-1:111122223333:alerts'],
  ['monitoring cannot create a role', 'iam:CreateRole', 'arn:aws:iam::111122223333:role/OtherRole'],
  ['monitoring cannot update a parameter', 'ssm:PutParameter', 'arn:aws:ssm:us-east-1:111122223333:parameter/example-two'],
  ['monitoring cannot create a key', 'kms:CreateKey', 'arn:aws:kms:us-east-1:111122223333:key/example-key'],
  ['monitoring cannot upload an artifact', 's3:PutObject', 'arn:aws:s3:::northstar-example-artifacts/new.zip'],
  ['monitoring cannot start a query export', 'logs:CreateExportTask', 'arn:aws:logs:us-east-1:111122223333:log-group:/northstar/api:*'],
  ['monitoring cannot delete a metric stream', 'cloudwatch:DeleteMetricStream', 'arn:aws:cloudwatch:us-east-1:111122223333:metric-stream/example']
];
monitoringDenies.forEach(([name, action, resource]) => check(name, 'monitoring-permissions.json', request(action, resource), false));
