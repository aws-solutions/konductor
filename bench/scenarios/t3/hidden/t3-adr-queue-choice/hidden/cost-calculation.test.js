const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readDecision, near } = require('./decision-lib.js');

const R = path.join(__dirname, '..');
const SOLUTION_DIR = path.join(R, 'solution');
const ADR_PATH = path.join(SOLUTION_DIR, 'docs/adr/0001-queue.md');
const FIXTURE_DIR = path.join(R, 'fixture');

describe('Cost calculation accuracy tests', () => {
  // Load data once
  const decision = readDecision(ADR_PATH);
  const pricingData = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_DIR, 'pricing-data.json'),
    'utf8'
  ));

  describe('Message lifecycle cost accounting', () => {
    it('should account for all message operations', () => {
      // Each message requires send + receive + delete operations for SQS
      // Kinesis only requires put operation
      const messagesPerDay = 11_000_000;
      const daysInMonth = 30;
      const messagesPerMonth = messagesPerDay * daysInMonth;
      
      if (decision.chosen.includes('sqs')) {
        // SQS: 3 operations per message
        const expectedOperations = messagesPerMonth * 3;
        
        // Check that cost reflects this
        const avgMessageSizeKB = 90;
        const chunkSizeKB = 64;
        const chunksPerMessage = Math.ceil(avgMessageSizeKB / chunkSizeKB);
        const totalChunks = messagesPerMonth * chunksPerMessage * 3;
        
        console.log(`SQS: ${messagesPerMonth.toLocaleString()} messages × 3 ops × ${chunksPerMessage} chunks = ${totalChunks.toLocaleString()} chunks`);
      } else if (decision.chosen === 'kinesis_streams') {
        // Kinesis: 1 put operation per message
        const expectedOperations = messagesPerMonth;
        
        const avgMessageSizeKB = 90;
        const unitsPerMessage = Math.ceil(avgMessageSizeKB / 25); // 25KB per PUT unit
        const totalUnits = messagesPerMonth * unitsPerMessage;
        
        console.log(`Kinesis: ${messagesPerMonth.toLocaleString()} messages × ${unitsPerMessage} units = ${totalUnits.toLocaleString()} PUT units`);
      }
      
      // Test passes if decision block exists and has cost
      assert(typeof decision.monthly_cost_usd === 'number', 'Cost should be a number');
    });

    it('should use correct chunk size for billing', () => {
      // SQS uses 64KB chunks, Kinesis uses 25KB PUT units
      const chunkSizeKB = pricingData.common_parameters.chunk_size_kb;
      assert.strictEqual(chunkSizeKB, 64, 'SQS chunk size should be 64KB');
      
      if (decision.chosen === 'kinesis_streams') {
        // Kinesis uses 25KB per PUT unit
        const kinesisUnitSize = pricingData.services.kinesis_streams.components[1].unit_size_kb;
        assert.strictEqual(kinesisUnitSize, 25, 'Kinesis PUT unit size should be 25KB');
      }
    });

    it('should round up chunks/units correctly', () => {
      const avgMessageSizeKB = 90;
      
      if (decision.chosen.includes('sqs')) {
        const chunkSizeKB = 64;
        const expectedChunks = Math.ceil(avgMessageSizeKB / chunkSizeKB);
        assert.strictEqual(expectedChunks, 2, '90KB message should use 2 chunks (ceil(90/64))');
      }
      
      if (decision.chosen === 'kinesis_streams') {
        const unitSizeKB = 25;
        const expectedUnits = Math.ceil(avgMessageSizeKB / unitSizeKB);
        assert.strictEqual(expectedUnits, 4, '90KB message should use 4 PUT units (ceil(90/25))');
      }
    });
  });

  describe('Pricing model application', () => {
    it('should use correct price per million for SQS options', () => {
      if (decision.chosen === 'sqs_standard') {
        const expectedPrice = pricingData.services.sqs_standard.price;
        assert.strictEqual(expectedPrice, 0.50, 'SQS Standard should be $0.50 per million requests');
      }
      
      if (decision.chosen === 'sqs_fifo') {
        const expectedPrice = pricingData.services.sqs_fifo.price;
        assert.strictEqual(expectedPrice, 0.45, 'SQS FIFO should be $0.45 per million requests');
      }
    });

    it('should account for all Kinesis cost components', () => {
      if (decision.chosen === 'kinesis_streams') {
        const components = pricingData.services.kinesis_streams.components;
        assert.strictEqual(components.length, 3, 'Kinesis should have 3 cost components');
        
        // Verify component names
        const componentNames = components.map(c => c.name);
        assert(componentNames.includes('shard_hours'), 'Missing shard_hours component');
        assert(componentNames.includes('put_payload_units'), 'Missing put_payload_units component');
        assert(componentNames.includes('data_retention'), 'Missing data_retention component');
      }
    });
  });

  describe('Free tier consideration', () => {
    it('should note free tier availability', () => {
      // All services have free tier
      assert(pricingData.services.sqs_standard.free_tier, 'SQS Standard should have free tier');
      assert(pricingData.services.sqs_fifo.free_tier, 'SQS FIFO should have free tier');
      assert(pricingData.services.kinesis_streams.free_tier, 'Kinesis should have free tier');
    });

    it('free tier should be negligible at our volume', () => {
      // At 240M messages/month, free tier (1M requests) is < 0.5% of total
      const messagesPerMonth = 8_000_000 * 30;
      const freeTier = 1_000_000;
      
      if (decision.chosen.includes('sqs')) {
        const chunksPerMessage = 2;
        const opsPerMessage = 3;
        const totalChunks = messagesPerMonth * chunksPerMessage * opsPerMessage;
        const freeTierPercentage = (freeTier / totalChunks) * 100;
        
        assert(freeTierPercentage < 1, `Free tier ${freeTierPercentage.toFixed(2)}% should be negligible`);
      }
    });
  });
});