// Expected values for the test suite
const fs = require('fs');
const path = require('path');

// Read fixture data
const pricingData = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixture/pricing-data.json'), 'utf8'));

// Constants from fixture files
const DATABASE_SIZE_TB = 8;
const DATABASE_SIZE_GB = DATABASE_SIZE_TB * 1024; // 8192 GB
const BUSINESS_RPO_MIN = 5;
const BUSINESS_RTO_MIN = 45;
const MONTHLY_BUDGET_USD = 12000;
const RESTORE_THROUGHPUT_GBPS = 1.2;
const MAX_RESTORE_STREAMS = 2;

// Compute restore time
const MAX_RESTORE_THROUGHPUT_GBPS = RESTORE_THROUGHPUT_GBPS * MAX_RESTORE_STREAMS;
const RESTORE_TIME_MINUTES = (DATABASE_SIZE_GB / MAX_RESTORE_THROUGHPUT_GBPS) / 60;

// Option definitions
const OPTIONS = {
  'nightly-backup': {
    rpoMinutes: 24 * 60, // 1440 minutes
    rtoMinutes: RESTORE_TIME_MINUTES + 23, // restore + startup/validation
    monthlyCost: 2524 // From decision-options.md
  },
  'pilot-light': {
    rpoMinutes: 5,
    rtoMinutes: 65,
    monthlyCost: 8764 // From decision-options.md
  },
  'warm-standby': {
    rpoMinutes: 2,
    rtoMinutes: 15,
    monthlyCost: 11904 // From decision-options.md
  }
};

// Hard limits from requirements
const HARD_LIMITS = {
  rpo_min: BUSINESS_RPO_MIN,
  rto_min: BUSINESS_RTO_MIN,
  monthly_budget_usd: MONTHLY_BUDGET_USD
};

// The correct choice is warm-standby (only one that meets all limits)
const CORRECT_CHOICE = 'warm-standby';
const TEMPTING_CHOICE = 'nightly-backup'; // Looks cheapest but breaks limits

module.exports = {
  DATABASE_SIZE_GB,
  BUSINESS_RPO_MIN,
  BUSINESS_RTO_MIN,
  MONTHLY_BUDGET_USD,
  RESTORE_TIME_MINUTES,
  OPTIONS,
  HARD_LIMITS,
  CORRECT_CHOICE,
  TEMPTING_CHOICE
};