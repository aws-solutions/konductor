const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { evaluate, isAllowed, decide, lint } = require('./iam-eval.js');

// S3 server access logs are written by logging.s3.amazonaws.com in AWS; a policy may also grant
// delivery.logs.amazonaws.com. CloudFront standard logs (v2) come from delivery.logs.amazonaws.com.
const LOG_WRITERS = ['delivery.logs.amazonaws.com', 'logging.s3.amazonaws.com'];
const logPut = (bucket, key, service, context) => ({
  action: 's3:PutObject',
  resource: `arn:aws:s3:::${bucket}/${key}`,
  principal: { Service: service },
  context: { 'aws:SecureTransport': 'true', ...context },
});

describe('bucket policies - hidden tests', () => {
  let assetsPolicy, downloadsPolicy, logsPolicy, cdnConfig;
  let deployRolePolicy;
  
  beforeEach(() => {
    // Load policies from the paths the agent will edit
    assetsPolicy = JSON.parse(fs.readFileSync('infra/buckets/assets-policy.json', 'utf8'));
    downloadsPolicy = JSON.parse(fs.readFileSync('infra/buckets/downloads-policy.json', 'utf8'));
    logsPolicy = JSON.parse(fs.readFileSync('infra/buckets/logs-policy.json', 'utf8'));
    deployRolePolicy = JSON.parse(fs.readFileSync('infra/iam/deploy-role-policy.json', 'utf8'));
    cdnConfig = JSON.parse(fs.readFileSync('infra/cdn-config.json', 'utf8'));
  });
  
  describe('policy validation', () => {
    it('all three bucket policies are valid IAM', () => {
      for (const [name, doc] of [['assets', assetsPolicy], ['downloads', downloadsPolicy], ['logs', logsPolicy]]) {
        const problems = lint(doc);
        assert.strictEqual(problems.length, 0, `${name} policy problems: ${problems.join(', ')}`);
      }
    });
    
  });
  
  describe('assets bucket - access control', () => {
    it('anonymous user cannot GetObject', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/public/file.txt`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Anonymous should not access assets');
    });
    
    it('staging CDN cannot access production assets', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.assets}/images/prod-only.png`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn, // Staging CDN
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Staging CDN should not access production assets');
    });
    
    it('production CDN cannot access staging assets', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/test/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.production.arn, // Production CDN
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Production CDN should not access staging assets');
    });
    
    it('CDN from another account cannot access assets', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/images/logo.png`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': 'arn:aws:cloudfront::999988887777:distribution/OTHER123', // Different account
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Foreign CDN should not access assets');
    });
    
    it('non-deploy role cannot PutObject', () => {
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/unauthorized.txt`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/other-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Other roles should not write to assets');
    });
    
    it('HTTP access is denied (TLS enforcement)', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/images/logo.png`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn,
          'aws:SecureTransport': 'false' // Non-TLS
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Non-TLS access should be denied');
    });
    
    it('deploy role can manage assets (Put, Delete, List)', () => {
      const putReq = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/new-file.txt`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/deploy-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      const deleteReq = {
        action: 's3:DeleteObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.assets}/old-file.txt`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/deploy-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      const listReq = {
        action: 's3:ListBucket',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/deploy-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      
      // The deploy role is in the same account: its identity policy and the bucket policy are evaluated together.
      const both = { identity: [deployRolePolicy], resource: [assetsPolicy] };
      assert.ok(decide(both, putReq), 'Deploy role should PutObject');
      assert.ok(decide(both, deleteReq), 'Deploy role should DeleteObject');
      assert.ok(decide(both, listReq), 'Deploy role should ListBucket');
    });
  });
  
  describe('downloads bucket - access control', () => {
    it('CDN cannot access private downloads', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.downloads}/private/internal-tool.exe`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn,
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'CDN should not access private downloads');
    });
    
    it('staging CDN cannot access production downloads', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.downloads}/public/release.exe`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn,
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Staging CDN should not access production downloads');
    });
    
    it('anonymous user cannot GetObject', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.downloads}/public/file.exe`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Anonymous should not access downloads');
    });
    
    it('wildcard SourceArn should not be allowed', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.downloads}/public/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': 'arn:aws:cloudfront::111122223333:distribution/*', // Wildcard
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Wildcard SourceArn should not be allowed');
    });
    
    it('HTTP access is denied for downloads', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.downloads}/file.exe`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.production.arn,
          'aws:SecureTransport': 'false'
        }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Downloads: HTTP should be denied');
    });
    
    it('private downloads are denied even with correct CDN', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.downloads}/private/secret.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.production.arn,
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Private downloads should be denied even via CDN');
    });
  });
  
  describe('logs bucket - access control', () => {
    it('log delivery service cannot PutObject with wrong source account', () => {
      for (const service of LOG_WRITERS) {
        const req = logPut(cdnConfig.bucketNames.staging.logs, 'cloudfront-logs/file.gz', service, { 'aws:SourceAccount': '999988887777' });
        assert.ok(!isAllowed([logsPolicy], req), `${service} from wrong account should be denied`);
      }
    });
    
    it('other principals cannot PutObject to logs', () => {
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.logs}/custom-logs/data.log`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/other-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([logsPolicy], req), 'Other roles should not write logs');
    });
    
    it('log delivery cannot write outside logs prefix', () => {
      for (const service of LOG_WRITERS) {
        const req = logPut(cdnConfig.bucketNames.staging.logs, 'other-data/config.json', service, {
          'aws:SourceAccount': cdnConfig.accountId,
          'aws:SourceArn': `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}`,
        });
        assert.ok(!isAllowed([logsPolicy], req), `${service} should not write outside the log prefixes`);
      }
    });
    
    it('log delivery can write to correct prefixes with TLS and source account', () => {
      for (const stage of ['staging', 'production']) {
        const cf = logPut(cdnConfig.bucketNames[stage].logs, 'cloudfront-logs/2024/01/01/file.gz', 'delivery.logs.amazonaws.com', { 'aws:SourceAccount': cdnConfig.accountId });
        assert.ok(isAllowed([logsPolicy], cf), `CloudFront log delivery should write ${stage} logs`);
        const s3ctx = { 'aws:SourceAccount': cdnConfig.accountId, 'aws:SourceArn': `arn:aws:s3:::${cdnConfig.bucketNames[stage].assets}` };
        const ok = LOG_WRITERS.some((service) => isAllowed([logsPolicy], logPut(cdnConfig.bucketNames[stage].logs, 's3-access-logs/2024-01-01.log', service, s3ctx)));
        assert.ok(ok, `S3 server access logs should reach ${stage} logs`);
      }
    });
  });
  
  describe('additional validation', () => {
    it('assets policy does not allow anonymous ListBucket', () => {
      const req = {
        action: 's3:ListBucket',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Anonymous should not ListBucket assets');
    });
    
    it('downloads policy does not allow anonymous ListBucket', () => {
      const req = {
        action: 's3:ListBucket',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.downloads}`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Anonymous should not ListBucket downloads');
    });
    
    it('assets policy does not allow DeleteObject by anonymous', () => {
      const req = {
        action: 's3:DeleteObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.assets}/file.txt`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'Anonymous should not DeleteObject from assets');
    });
    
    it('logs policy requires SourceAccount condition', () => {
      for (const service of LOG_WRITERS) {
        const req = logPut(cdnConfig.bucketNames.staging.logs, 'cloudfront-logs/file.gz', service, {});
        assert.ok(!isAllowed([logsPolicy], req), `${service} without a source account or source should be denied`);
      }
    });
    
    it('CDN access requires exact SourceArn match', () => {
      // Test with similar but wrong ARN
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': 'arn:aws:cloudfront::111122223333:distribution/DIFFERENT', // Wrong ID
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'CDN should require exact distribution ARN');
    });
    
    it('deploy role cannot access downloads bucket', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.downloads}/public/file.txt`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/deploy-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([downloadsPolicy], req), 'Deploy role should not read downloads');
    });
    
    it('deploy role cannot access logs bucket', () => {
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.logs}/test.txt`,
        principal: { AWS: 'arn:aws:iam::111122223333:role/deploy-role' },
        context: { 'aws:SecureTransport': 'true' }
      };
      assert.ok(!isAllowed([logsPolicy], req), 'Deploy role should not write logs');
    });
    
    it('CDN read without a SourceArn is denied', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([assetsPolicy], req), 'CDN reads must name the distribution');
    });
  });

  describe('CDN reads its own stage (added by the lead: a deny-all policy must not pass)', () => {
    const cdnGet = (stage, bucketKind, key, src = stage) => ({
      action: 's3:GetObject',
      resource: `arn:aws:s3:::${cdnConfig.bucketNames[stage][bucketKind]}/${key}`,
      principal: { Service: 'cloudfront.amazonaws.com' },
      context: { 'aws:SourceArn': cdnConfig.distributions[src].arn, 'aws:SecureTransport': 'true', 'aws:SourceAccount': cdnConfig.accountId },
    });
    it('each stage CDN reads its own assets and public downloads over TLS', () => {
      for (const stage of ['staging', 'production']) {
        assert.ok(isAllowed([assetsPolicy], cdnGet(stage, 'assets', 'images/logo.png')), `${stage} assets`);
        assert.ok(isAllowed([downloadsPolicy], cdnGet(stage, 'downloads', 'releases/app-2.1.zip')), `${stage} downloads`);
      }
    });
  });
});