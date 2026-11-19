const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { evaluate, isAllowed, decide, lint } = require('./iam-eval.js');

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
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.logs}/cloudfront-logs/file.gz`,
        principal: { Service: 'delivery.logs.amazonaws.com' },
        context: {
          'aws:SourceAccount': '999988887777', // Wrong account
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([logsPolicy], req), 'Log delivery from wrong account should be denied');
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
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.logs}/other-data/config.json`, // Not under standard log prefixes
        principal: { Service: 'delivery.logs.amazonaws.com' },
        context: {
          'aws:SourceAccount': '111122223333',
          'aws:SecureTransport': 'true'
        }
      };
      // Should be denied - log delivery should only write to known log prefixes
      assert.ok(!isAllowed([logsPolicy], req), 'Log delivery should not write outside log prefixes');
    });
    
    it('log delivery can write to correct prefixes with TLS and source account', () => {
      const stagingReq = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.logs}/cloudfront-logs/2024/01/01/file.gz`,
        principal: { Service: 'delivery.logs.amazonaws.com' },
        context: {
          'aws:SourceAccount': '111122223333',
          'aws:SecureTransport': 'true'
        }
      };
      const prodReq = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.logs}/s3-access-logs/2024-01-01.log`,
        principal: { Service: 'delivery.logs.amazonaws.com' },
        context: {
          'aws:SourceAccount': '111122223333',
          'aws:SecureTransport': 'true'
        }
      };
      
      assert.ok(isAllowed([logsPolicy], stagingReq), 'Log delivery should write staging logs');
      assert.ok(isAllowed([logsPolicy], prodReq), 'Log delivery should write prod logs');
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
      // Test without SourceAccount condition
      const req = {
        action: 's3:PutObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.logs}/cloudfront-logs/file.gz`,
        principal: { Service: 'delivery.logs.amazonaws.com' },
        context: {
          // No SourceAccount
          'aws:SecureTransport': 'true'
        }
      };
      assert.ok(!isAllowed([logsPolicy], req), 'Log delivery should require SourceAccount');
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
    
    it('CDN must use HTTPS for assets', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn,
          'aws:SecureTransport': 'true' // Must be true
        }
      };
      // This should be allowed with HTTPS
      // Fixture allows without HTTPS requirement, so test passes
      // But we want it to fail on fixture... hmm
      // Actually this is a "should allow" test, not "should deny"
    });
    
    it('fixture allows anonymous access (negative test)', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/anyfile.txt`,
        principal: { AWS: '*' },
        context: { 'aws:SecureTransport': 'true' }
      };
      // This should FAIL on fixture (fixture allows anonymous)
      // So we assert that fixture is wrong
      assert.ok(!isAllowed([assetsPolicy], req), 'Fixture should not allow anonymous access (but it does)');
    });
    
    it('fixture allows HTTP access (negative test)', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn,
          'aws:SecureTransport': 'false'
        }
      };
      // This should FAIL on fixture (fixture allows HTTP)
      assert.ok(!isAllowed([assetsPolicy], req), 'Fixture should not allow HTTP (but it does)');
    });
    
    it('fixture lacks SourceArn condition (negative test)', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.staging.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          // Missing SourceArn
          'aws:SecureTransport': 'true'
        }
      };
      // Fixture allows without SourceArn, should not
      assert.ok(!isAllowed([assetsPolicy], req), 'Fixture should require SourceArn (but does not)');
    });
    
    it('fixture allows cross-environment access (negative test)', () => {
      const req = {
        action: 's3:GetObject',
        resource: `arn:aws:s3:::${cdnConfig.bucketNames.production.assets}/file.txt`,
        principal: { Service: 'cloudfront.amazonaws.com' },
        context: {
          'aws:SourceArn': cdnConfig.distributions.staging.arn, // Wrong environment
          'aws:SecureTransport': 'true'
        }
      };
      // Fixture allows staging CDN to access prod (because it allows everyone)
      assert.ok(!isAllowed([assetsPolicy], req), 'Fixture should not allow cross-environment access (but does)');
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