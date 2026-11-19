#!/usr/bin/env node

// Sample cost calculator for queue services
// This is a reference implementation - you should verify calculations

const fs = require('fs');

// Load pricing data
const pricingData = JSON.parse(fs.readFileSync('pricing-data.json', 'utf8'));

function calculateSQSCost(messagesPerMonth, chunksPerMessage, pricePerMillion) {
  // Each message lifecycle: send + receive + delete = 3 operations
  const requestsPerMessage = 3;
  const totalChunks = messagesPerMonth * chunksPerMessage * requestsPerMessage;
  const cost = (totalChunks / 1000000) * pricePerMillion;
  return cost;
}

function calculateKinesisCost(messagesPerMonth, messageSizeKB, shards) {
  const hoursPerMonth = 24 * 30;
  
  // Shard cost
  const shardCost = shards * hoursPerMonth * 0.02;
  
  // PUT payload units (25KB each)
  const unitsPerMessage = Math.ceil(messageSizeKB / 25);
  const totalUnits = messagesPerMonth * unitsPerMessage;
  const putCost = (totalUnits / 1000000) * 0.014;
  
  // Data retention (beyond 24h) - assuming 24h default
  const dataGB = (messagesPerMonth * messageSizeKB * 1024) / (1024 * 1024 * 1024);
  const retentionCost = dataGB * 0.02;
  
  return shardCost + putCost + retentionCost;
}

// Example usage
const messagesPerMonth = 240000000; // 8M/day * 30
const messageSizeKB = 90;
const chunksPerMessage = Math.ceil(messageSizeKB / 64);

console.log('Cost Calculator Example');
console.log('=======================');
console.log(`Messages per month: ${messagesPerMonth.toLocaleString()}`);
console.log(`Message size: ${messageSizeKB} KB`);
console.log(`Chunks per message (64KB): ${chunksPerMessage}`);
console.log();

const sqsStandardCost = calculateSQSCost(messagesPerMonth, chunksPerMessage, 0.50);
const sqsFifoCost = calculateSQSCost(messagesPerMonth, chunksPerMessage, 0.45);
const kinesisCost = calculateKinesisCost(messagesPerMonth, messageSizeKB, 4);

console.log('Estimated Monthly Costs:');
console.log(`SQS Standard: $${sqsStandardCost.toFixed(2)}`);
console.log(`SQS FIFO: $${sqsFifoCost.toFixed(2)}`);
console.log(`Kinesis (4 shards): $${kinesisCost.toFixed(2)}`);
console.log();

const budget = 900;
console.log(`Budget: $${budget}`);
console.log('Within budget?');
console.log(`SQS Standard: ${sqsStandardCost <= budget ? 'YES' : 'NO'}`);
console.log(`SQS FIFO: ${sqsFifoCost <= budget ? 'YES' : 'NO'}`);
console.log(`Kinesis: ${kinesisCost <= budget ? 'YES' : 'NO'}`);

// Note: This is a simplified calculation. Actual costs may vary based on:
// - Free tier usage
// - Batch operations
// - Data transfer patterns
// - Additional features used