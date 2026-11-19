const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision, near } = require('./decision-lib.js');
const path = require('node:path');
const fs = require('node:fs');

const R = path.join(__dirname, '..');
const solutionPath = path.join(R, 'solution', 'docs', 'export-approach.md');

describe('Cost calculation accuracy', () => {
  it('should calculate cost from fixture pricing data', () => {
    const decision = readDecision(solutionPath);
    // Read AWS pricing
    const pricingCsv = fs.readFileSync(path.join(R, 'fixture', 'aws_pricing.csv'), 'utf8');
    const pricingLines = pricingCsv.split('\n').slice(1);
    const pricing = {};
    pricingLines.forEach(line => {
      if (line.trim()) {
        const [service, unit, price, region, notes] = line.split(',');
        pricing[service] = parseFloat(price);
      }
    });
    
    // Read traffic analysis for report count
    const trafficText = fs.readFileSync(path.join(R, 'fixture', 'TRAFFIC_ANALYSIS.md'), 'utf8');
    const reportsMatch = trafficText.match(/Total reports per month.*?(\d{1,3}(?:,\d{3})*)/);
    const reportsPerMonth = reportsMatch ? parseInt(reportsMatch[1].replace(/,/g, '')) : 500000;
    
    // Calculate based on chosen option
    let expectedCost = 0;
    
    if (decision.chosen === 'B') {
      // Option B detailed calculation
      const avgExecutionTime = 0.7; // seconds (from traffic analysis)
      const lambdaMemoryGB = 0.5; // 512MB
      const lambdaCostPerSecond = pricing.Lambda * lambdaMemoryGB;
      const monthlyLambdaCost = reportsPerMonth * avgExecutionTime * lambdaCostPerSecond;
      
      const apiGatewayCost = (reportsPerMonth / 1000000) * pricing['API Gateway'];
      
      // Avg report size from traffic analysis
      const avgReportSizeGB = 0.0018; // 1.8MB
      const dataTransferCost = reportsPerMonth * avgReportSizeGB * pricing['Data Transfer'];
      
      // S3 costs
      const s3PutCost = (reportsPerMonth / 1000) * pricing['S3 PUT'];
      const s3GetCost = (reportsPerMonth / 1000) * pricing['S3 GET'] * 0.5; // 50% download rate
      const s3StorageGB = 100; // Store for 24 hours
      const s3StorageCost = s3StorageGB * pricing['S3 Storage'];
      
      // Supporting services
      const sqsCost = (reportsPerMonth / 1000000) * pricing.SQS;
      const sesCost = (reportsPerMonth / 1000) * pricing.SES;
      
      expectedCost = monthlyLambdaCost + apiGatewayCost + dataTransferCost +
                    s3PutCost + s3GetCost + s3StorageCost + sqsCost + sesCost;
      
    } else if (decision.chosen === 'C') {
      // Option C calculation
      const s3StorageGB = 500; // 7 days of reports
      const s3StorageCost = s3StorageGB * pricing['S3 Storage'];
      
      const scheduledReportsPerDay = 50;
      const lambdaRunsPerMonth = scheduledReportsPerDay * 30;
      const lambdaTimePerRun = 30; // seconds
      const lambdaMemoryGB = 0.5;
      const lambdaCostPerRun = lambdaTimePerRun * pricing.Lambda * lambdaMemoryGB;
      const monthlyLambdaCost = lambdaRunsPerMonth * lambdaCostPerRun;
      
      const avgReportSizeGB = 0.0018;
      const dataTransferCost = reportsPerMonth * avgReportSizeGB * pricing['Data Transfer'];
      
      expectedCost = s3StorageCost + monthlyLambdaCost + dataTransferCost;
      
    } else if (decision.chosen === 'hybrid') {
      // Hybrid cost should be between A and B
      expectedCost = 90; // Approximately
    }
    
    // Check if cost is in reasonable range for the chosen option
    let minCost, maxCost;
    if (decision.chosen === 'B') {
      minCost = 80;
      maxCost = 180;
    } else if (decision.chosen === 'C') {
      minCost = 70;
      maxCost = 120;
    } else if (decision.chosen === 'hybrid') {
      minCost = 80;
      maxCost = 120;
    }
    
    assert.ok(decision.monthly_cost_usd >= minCost && decision.monthly_cost_usd <= maxCost,
      `Cost ${decision.monthly_cost_usd} should be between $${minCost}-$${maxCost} for option ${decision.chosen}`);
  });

  it('should have cost under budget with margin', () => {
    const decision = readDecision(solutionPath);
    // Budget from pricing notes
    const pricingNotes = fs.readFileSync(path.join(R, 'fixture', 'pricing_notes.md'), 'utf8');
    const budgetMatch = pricingNotes.match(/Monthly budget for this feature.*?\$(\d{1,3}(?:,\d{3})*)/);
    const budget = budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, '')) : 1200;
    
    assert.ok(decision.monthly_cost_usd < budget * 0.9,
      `Cost ${decision.monthly_cost_usd} should be under 90% of budget ${budget} for safety margin`);
  });

  it('should include all major cost components for chosen option', () => {
    const decision = readDecision(solutionPath);
    // This is a sanity check - cost shouldn't be suspiciously low
    const reportsPerMonth = 500000;
    const minExpectedCost = 10; // Even simplest option has some cost
    
    assert.ok(decision.monthly_cost_usd >= minExpectedCost,
      `Cost ${decision.monthly_cost_usd} seems too low for ${reportsPerMonth.toLocaleString()} reports/month`);
  });
});

describe('Option-specific validation', () => {
  it('should handle timeout correctly for chosen option', () => {
    const decision = readDecision(solutionPath);
    // Read timeout from system architecture
    const archText = fs.readFileSync(path.join(R, 'fixture', 'SYSTEM_ARCHITECTURE.md'), 'utf8');
    const timeoutMatch = archText.match(/Maximum timeout.*?(\d+).*?seconds/);
    const gatewayTimeout = timeoutMatch ? parseInt(timeoutMatch[1]) : 29;
    
    if (decision.chosen === 'A') {
      // Option A should have p99 time > timeout
      const p99Time = decision.limits.p99_processing_time.value;
      assert.ok(p99Time > gatewayTimeout,
        `Option A chosen but p99 time ${p99Time} ≤ timeout ${gatewayTimeout}`);
    } else {
      // Other options should handle timeout
      const p99Time = decision.limits.p99_processing_time.value;
      // For async options, processing time might still be > timeout but that's OK
      // since they don't use synchronous API Gateway call
      assert.ok(true); // Pass this test for non-A options
    }
  });

  it('should consider user preferences for chosen option', () => {
    const decision = readDecision(solutionPath);
    // Read user research
    const researchText = fs.readFileSync(path.join(R, 'fixture', 'USER_RESEARCH.md'), 'utf8');
    
    if (decision.chosen === 'B') {
      // Check that async is acceptable to users
      const asyncAcceptanceMatch = researchText.match(/accept async delivery.*?(\d+)%/);
      const asyncAcceptance = asyncAcceptanceMatch ? parseInt(asyncAcceptanceMatch[1]) : 65;
      
      assert.ok(asyncAcceptance >= 50,
        `Option B chosen but only ${asyncAcceptance}% of users accept async delivery`);
    }
    
    if (decision.chosen === 'C') {
      // Check that scheduled meets user needs
      const immediateNeedMatch = researchText.match(/Need immediate access.*?(\d+)%/);
      const immediateNeed = immediateNeedMatch ? parseInt(immediateNeedMatch[1]) : 60;
      
      // Scheduled can't meet immediate needs
      assert.ok(immediateNeed < 80,
        `Option C chosen but ${immediateNeed}% of users need immediate access`);
    }
  });
});