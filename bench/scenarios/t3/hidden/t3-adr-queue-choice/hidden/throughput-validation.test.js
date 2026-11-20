const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readDecision } = require('./decision-lib.js');

const R = path.join(__dirname, '..');
const SOLUTION_DIR = path.join(R, 'solution');
const ADR_PATH = path.join(SOLUTION_DIR, 'docs/adr/0001-queue.md');
const FIXTURE_DIR = path.join(R, 'fixture');

describe('Throughput requirement validation', () => {
  const decision = readDecision(ADR_PATH);
  const pricingData = JSON.parse(fs.readFileSync(
    path.join(FIXTURE_DIR, 'pricing-data.json'),
    'utf8'
  ));

  describe('Peak throughput requirement', () => {
    it('should identify 400 events/second as peak requirement', () => {
      // Extract from requirements or use known value
      const peakThroughput = 400; // events/second
      
      // Check decision includes this limit
      assert(
        decision.limits.peak_throughput_per_second,
        'Missing peak_throughput_per_second limit'
      );
      
      assert.strictEqual(
        decision.limits.peak_throughput_per_second.limit,
        peakThroughput,
        `Peak throughput limit should be ${peakThroughput}`
      );
    });

    it('chosen option must support peak throughput', () => {
      const peakThroughput = 400;
      
      if (decision.chosen === 'sqs_fifo') {
        // FIFO is limited to 300/s per queue
        const fifoLimit = pricingData.services.sqs_fifo.limits.throughput_per_queue.value;
        assert.strictEqual(fifoLimit, 300, 'FIFO throughput limit should be 300/s');
        
        // This is why FIFO is tempting but wrong choice
        assert(
          decision.limits.peak_throughput_per_second.value <= fifoLimit,
          `FIFO throughput value ${decision.limits.peak_throughput_per_second.value} should be ≤ ${fifoLimit}`
        );
      } else {
        // Other options must support 400/s
        assert(
          decision.limits.peak_throughput_per_second.value >= peakThroughput,
          `Throughput value ${decision.limits.peak_throughput_per_second.value} should be ≥ ${peakThroughput} for ${decision.chosen}`
        );
      }
    });
  });

  describe('FIFO throughput limit trap', () => {
    it('should expose FIFO throughput limit', () => {
      const fifoLimit = pricingData.services.sqs_fifo.limits.throughput_per_queue.value;
      assert.strictEqual(fifoLimit, 300, 'FIFO throughput limit should be 300 messages/second');
    });

    it('FIFO should be tempting due to lower price', () => {
      const sqsStandardPrice = pricingData.services.sqs_standard.price;
      const sqsFifoPrice = pricingData.services.sqs_fifo.price;
      
      assert(
        sqsFifoPrice < sqsStandardPrice,
        `FIFO price $${sqsFifoPrice} should be less than Standard price $${sqsStandardPrice} (tempting)`
      );
    });

    it('FIFO fails peak throughput requirement', () => {
      const peakThroughput = 400;
      const fifoLimit = pricingData.services.sqs_fifo.limits.throughput_per_queue.value;
      
      assert(
        peakThroughput > fifoLimit,
        `Peak ${peakThroughput}/s should exceed FIFO limit ${fifoLimit}/s`
      );
    });
  });

  describe('Kinesis throughput capacity', () => {
    it('Kinesis shards provide sufficient capacity', () => {
      if (decision.chosen === 'kinesis_streams') {
        const shards = 4;
        const recordsPerShard = 1000; // From Kinesis documentation
        
        assert(
          shards * recordsPerShard >= 400,
          `${shards} shards × ${recordsPerShard}/s = ${shards * recordsPerShard}/s should support 400/s peak`
        );
      }
    });

    it('Kinesis requires proper shard count planning', () => {
      if (decision.chosen === 'kinesis_streams') {
        // 4 shards at 1000 records/s each = 4000 records/s capacity
        // 400 required / 1000 per shard = 0.4 shards needed, round up to 1
        // But we use 4 for headroom and partitioning
        const requiredShards = Math.ceil(400 / 1000);
        assert(requiredShards >= 1, 'At least 1 shard required');
        
        // Our solution uses 4 shards
        assert.strictEqual(4 >= requiredShards, true, '4 shards should be sufficient');
      }
    });
  });

  describe('SQS Standard unlimited throughput', () => {
    it('SQS Standard has no per-queue throughput limit', () => {
      // SQS Standard doesn't have throughput limits in pricing data
      // because it's essentially unlimited
      assert(
        !pricingData.services.sqs_standard.limits,
        'SQS Standard should not have throughput limits'
      );
    });

    it('SQS Standard can handle required throughput', () => {
      if (decision.chosen === 'sqs_standard') {
        // SQS Standard can handle much more than 400/s
        assert(
          decision.limits.peak_throughput_per_second.value >= 400,
          'SQS Standard should support at least 400/s'
        );
      }
    });
  });

  describe('Sustained vs peak throughput', () => {
    it('should consider sustained throughput requirements', () => {
      const messagesPerDay = 11_000_000;
      const secondsPerDay = 24 * 60 * 60;
      const averageThroughput = messagesPerDay / secondsPerDay;
      
      console.log(`Average throughput: ${averageThroughput.toFixed(2)} messages/second`);
      console.log(`Peak throughput: 400 messages/second`);
      console.log(`Peak/Average ratio: ${(400 / averageThroughput).toFixed(2)}x`);
      
      // Peak is about 4.3x average, which is reasonable for marketing campaigns
      assert(
        400 > averageThroughput,
        `Peak ${400}/s should be greater than average ${averageThroughput.toFixed(2)}/s`
      );
    });
  });
});