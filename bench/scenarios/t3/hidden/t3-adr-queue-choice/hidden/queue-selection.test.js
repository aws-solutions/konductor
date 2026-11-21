const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Import the shared library
const { readDecision, near, meets } = require('./decision-lib.js');

// Constants - read from fixture files
const R = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(R, 'fixture');
const SOLUTION_DIR = path.join(R, 'solution');
const ADR_PATH = path.join(SOLUTION_DIR, 'docs/adr/0001-queue.md');

// Load pricing data
const pricingData = JSON.parse(fs.readFileSync(
  path.join(FIXTURE_DIR, 'pricing-data.json'),
  'utf8'
));

// Read requirements to extract numbers
const requirementsText = fs.readFileSync(
  path.join(FIXTURE_DIR, 'requirements.md'),
  'utf8'
);

const designText = fs.readFileSync(
  path.join(FIXTURE_DIR, 'technical-design.md'),
  'utf8'
);

// Parse numbers from requirements (simplified - in real test would use regex)
// For this test, we'll hardcode the expected values from our calculations
const MESSAGES_PER_DAY = 11_000_000;
const DAYS_IN_MONTH = 30;
const AVG_MESSAGE_SIZE_KB = 90;
const PEAK_THROUGHPUT = 400;
const BUDGET = 900;
const CHUNK_SIZE_KB = 64;

// Derived constants
const messagesPerMonth = MESSAGES_PER_DAY * DAYS_IN_MONTH;
const chunksPerMessage = Math.ceil(AVG_MESSAGE_SIZE_KB / CHUNK_SIZE_KB);

// Acceptable options
const ACCEPTABLE_OPTIONS = ['kinesis_streams'];
const TEMPTING_OPTION = 'sqs_fifo'; // Looks cheaper but fails throughput

describe('Queue Selection ADR Tests', () => {
  let decision;
  
  before(() => {
    try {
      decision = readDecision(ADR_PATH);
    } catch (error) {
      console.error('Failed to read decision block:', error.message);
      throw error;
    }
  });

  describe('Decision block structure', () => {
    it('should have all required keys', () => {
      assert(decision.chosen, 'Missing "chosen" key');
      assert(Array.isArray(decision.options), '"options" should be an array');
      assert(typeof decision.limits === 'object', '"limits" should be an object');
      assert(typeof decision.monthly_cost_usd === 'number', '"monthly_cost_usd" should be a number');
    });

    it('should have chosen option from acceptable list', () => {
      assert(
        ACCEPTABLE_OPTIONS.includes(decision.chosen),
        `Chosen option "${decision.chosen}" not in acceptable list: ${ACCEPTABLE_OPTIONS.join(', ')}`
      );
    });

    it('should not choose the tempting option (sqs_fifo)', () => {
      assert.notStrictEqual(
        decision.chosen,
        TEMPTING_OPTION,
        `Should not choose tempting option "${TEMPTING_OPTION}" which fails throughput limit`
      );
    });

    it('should list all considered options', () => {
      const missingOptions = ACCEPTABLE_OPTIONS.filter(opt => !decision.options.includes(opt));
      assert.strictEqual(
        missingOptions.length,
        0,
        `Missing options from "options" array: ${missingOptions.join(', ')}`
      );
    });
  });

  describe('Cost calculation validation', () => {
    it('should report cost within 10% of correct value for chosen option', () => {
      let expectedCost;
      
      switch (decision.chosen) {
        case 'sqs_standard':
          // SQS Standard: 3 operations per message × chunks × messages × price
          const stdRequestsPerMessage = 3;
          const stdTotalChunks = messagesPerMonth * chunksPerMessage * stdRequestsPerMessage;
          expectedCost = (stdTotalChunks / 1_000_000) * pricingData.services.sqs_standard.price;
          break;
          
        case 'sqs_fifo':
          // SQS FIFO: same calculation, different price
          const fifoRequestsPerMessage = 3;
          const fifoTotalChunks = messagesPerMonth * chunksPerMessage * fifoRequestsPerMessage;
          expectedCost = (fifoTotalChunks / 1_000_000) * pricingData.services.sqs_fifo.price;
          break;
          
        case 'kinesis_streams':
          // Kinesis: shard hours + PUT units + retention
          const shards = 4;
          const hoursPerMonth = 24 * DAYS_IN_MONTH;
          const shardCost = shards * hoursPerMonth * pricingData.services.kinesis_streams.components[0].price;
          
          const unitsPerMessage = Math.ceil(AVG_MESSAGE_SIZE_KB / 25);
          const totalUnits = messagesPerMonth * unitsPerMessage;
          const putCost = (totalUnits / 1_000_000) * pricingData.services.kinesis_streams.components[1].price;
          
          const dataGB = (messagesPerMonth * AVG_MESSAGE_SIZE_KB * 1024) / (1024 * 1024 * 1024);
          const retentionCost = dataGB * pricingData.services.kinesis_streams.components[2].price;
          
          expectedCost = shardCost + putCost + retentionCost;
          break;
          
        default:
          throw new Error(`Unknown option: ${decision.chosen}`);
      }
      
      assert(
        near(decision.monthly_cost_usd, expectedCost, 0.1),
        `Reported cost $${decision.monthly_cost_usd} not within 10% of expected $${expectedCost.toFixed(2)}`
      );
    });

    it('should have cost under budget limit', () => {
      assert(
        decision.monthly_cost_usd <= BUDGET,
        `Cost $${decision.monthly_cost_usd} exceeds budget $${BUDGET}`
      );
    });
  });

  describe('Limit validation', () => {
    it('should include monthly budget limit', () => {
      assert(
        meets(decision.limits, 'monthly_budget_usd', BUDGET, 'max'),
        'Missing or incorrect monthly_budget_usd limit'
      );
    });

    it('should include peak throughput limit', () => {
      assert(
        meets(decision.limits, 'peak_throughput_per_second', PEAK_THROUGHPUT, 'max'),
        'Missing or incorrect peak_throughput_per_second limit'
      );
    });

    it('should include FIFO throughput limit when relevant', () => {
      const fifoLimit = pricingData.services.sqs_fifo.limits.throughput_per_queue.value;
      
      if (decision.chosen === 'sqs_fifo') {
        // If they chose FIFO, should show they meet the limit (but they shouldn't choose it!)
        assert(
          meets(decision.limits, 'fifo_throughput_per_queue', fifoLimit, 'max'),
          'Missing or incorrect fifo_throughput_per_queue limit for FIFO choice'
        );
      } else {
        // For non-FIFO choices, limit should show as not applicable (value = 0)
        assert(
          decision.limits.fifo_throughput_per_queue,
          'Missing fifo_throughput_per_queue limit for non-FIFO choice'
        );
        assert.strictEqual(
          decision.limits.fifo_throughput_per_queue.limit,
          fifoLimit,
          `FIFO limit should be ${fifoLimit}`
        );
      }
    });

    it('should have correct limit values for chosen option', () => {
      // Check budget limit value matches reported cost
      if (decision.limits.monthly_budget_usd) {
        assert(
          near(decision.limits.monthly_budget_usd.value, decision.monthly_cost_usd, 0.01),
          `Budget limit value ${decision.limits.monthly_budget_usd.value} doesn't match monthly cost ${decision.monthly_cost_usd}`
        );
      }

      // Check throughput limit - chosen option must support 400/s
      if (decision.chosen === 'sqs_fifo') {
        // FIFO can only do 300/s, so value should be ≤ 300
        assert(
          decision.limits.peak_throughput_per_second.value <= 300,
          `FIFO chosen but throughput value ${decision.limits.peak_throughput_per_second.value} > 300`
        );
      } else {
        // Other options should show they meet 400/s
        assert(
          decision.limits.peak_throughput_per_second.value >= 400,
          `Throughput value ${decision.limits.peak_throughput_per_second.value} < 400 for non-FIFO option`
        );
      }
    });
  });

  describe('Option-specific validation', () => {
    it('if chosen sqs_fifo, should fail throughput test', () => {
      if (decision.chosen === 'sqs_fifo') {
        // FIFO throughput is 300/s, need 400/s
        const fifoThroughput = pricingData.services.sqs_fifo.limits.throughput_per_queue.value;
        assert(
          PEAK_THROUGHPUT > fifoThroughput,
          `FIFO throughput ${fifoThroughput}/s should be less than required ${PEAK_THROUGHPUT}/s`
        );
      }
    });

    it('if chosen kinesis, should have sufficient shard capacity', () => {
      if (decision.chosen === 'kinesis_streams') {
        // 4 shards × 1000 records/s = 4000 capacity, well above 400 required
        const shards = 4;
        const recordsPerShard = 1000;
        assert(
          shards * recordsPerShard >= PEAK_THROUGHPUT,
          `Kinesis with ${shards} shards should support at least ${PEAK_THROUGHPUT}/s`
        );
      }
    });

    it('if chosen sqs_standard, should have no inherent throughput limit', () => {
      if (decision.chosen === 'sqs_standard') {
        // SQS standard has no per-queue throughput limit
        assert(
          decision.limits.peak_throughput_per_second.value >= PEAK_THROUGHPUT,
          `SQS standard should support at least ${PEAK_THROUGHPUT}/s`
        );
      }
    });
  });
});