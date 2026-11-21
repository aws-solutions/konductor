const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const R = path.join(__dirname, '..');
const SOLUTION_DIR = path.join(R, 'solution');
const ADR_PATH = path.join(SOLUTION_DIR, 'docs/adr/0001-queue.md');

describe('ADR document validation', () => {
  const adrContent = fs.readFileSync(ADR_PATH, 'utf8');

  describe('Document structure', () => {
    it('should have decision block with correct info string', () => {
      const decisionBlockRegex = /^```decision\r?\n[\s\S]*?\r?\n```/m;
      assert(
        decisionBlockRegex.test(adrContent),
        'Missing fenced code block with info string "decision"'
      );
    });

    it('should include required content areas', () => {
      // The prompt requires: context, considered options, decision/rationale, consequences/implementation notes
      // We'll check for these more flexibly
      const hasContext = /context|problem|background/i.test(adrContent);
      const hasOptions = /option|consider|evaluat/i.test(adrContent) && 
                        (adrContent.includes('SQS') || adrContent.includes('Kinesis'));
      const hasDecision = /decision|select|choose|recommend/i.test(adrContent);
      const hasRationale = /rationale|reason|justif/i.test(adrContent);
      const hasConsequences = /consequence|implication|impact/i.test(adrContent);
      const hasImplementation = /implement|deploy|roll out|next step/i.test(adrContent);
      
      assert(hasContext, 'Should include context or problem statement');
      assert(hasOptions, 'Should evaluate options (SQS/Kinesis)');
      assert(hasDecision, 'Should state a decision');
      assert(hasRationale, 'Should provide rationale for decision');
      assert(hasConsequences || hasImplementation, 'Should discuss consequences or implementation notes');
    });
  });

  describe('Content quality', () => {
    it('should explain the problem context with key details', () => {
      // Should mention key numbers from requirements
      assert(adrContent.includes('11 million') || adrContent.includes('11,000,000'), 'Should mention 11 million daily events');
      assert(adrContent.includes('90KB') || adrContent.includes('90 KB'), 'Should mention 90KB message size');
      assert(adrContent.includes('400'), 'Should mention 400 events/second peak');
      assert(adrContent.includes('$900') || adrContent.includes('900'), 'Should mention $900 budget');
    });

    it('should mention key decision criteria', () => {
      // Should mention key criteria from requirements
      const hasCost = /cost|budget|price/i.test(adrContent);
      const hasThroughput = /throughput|capacity|events per second|messages per second/i.test(adrContent);
      const hasMessageSize = /message size|payload|chunk/i.test(adrContent);
      
      assert(hasCost, 'Should mention cost or budget');
      assert(hasThroughput, 'Should mention throughput or capacity');
      assert(hasMessageSize, 'Should mention message size or chunking');
    });

    it('should evaluate all three options', () => {
      // Should mention all three services
      assert(adrContent.includes('SQS Standard') || adrContent.includes('standard SQS'), 'Should evaluate SQS Standard');
      assert(adrContent.includes('SQS FIFO') || adrContent.includes('FIFO SQS'), 'Should evaluate SQS FIFO');
      assert(adrContent.includes('Kinesis') || adrContent.includes('Kinesis Stream'), 'Should evaluate Kinesis');
      
      // Should discuss pros and cons or tradeoffs
      const hasProsCons = /pros?|cons?|advantage|disadvantage|trade.?off|benefit|drawback/i.test(adrContent);
      assert(hasProsCons, 'Should discuss pros/cons or tradeoffs for options');
    });

    it('should provide clear decision with rationale', () => {
      // Should clearly state the chosen option
      const hasSelection = /select|choose|recommend|decision.*(?:SQS|Kinesis)/i.test(adrContent);
      assert(hasSelection, 'Should clearly state selection');
      
      // Should mention rationale
      const hasRationale = /rationale|reason|justif|because|since/i.test(adrContent);
      assert(hasRationale, 'Should provide rationale for decision');
      
      // Should mention key factors in rationale
      const rationaleText = adrContent.toLowerCase();
      assert(rationaleText.includes('cost') || rationaleText.includes('budget') || rationaleText.includes('price'), 'Should mention cost in rationale');
      assert(rationaleText.includes('throughput') || rationaleText.includes('capacity') || rationaleText.includes('events'), 'Should mention throughput in rationale');
    });

    it('should discuss consequences', () => {
      // Should discuss consequences or implications
      const hasConsequences = /consequence|implication|impact|effect|ramification/i.test(adrContent);
      assert(hasConsequences, 'Should discuss consequences or implications');
      
      // Should discuss both positive and negative aspects
      const text = adrContent.toLowerCase();
      const hasPositive = /positive|benefit|advantage|pro|strength|good/i.test(text);
      const hasNegative = /negative|drawback|disadvantage|con|weakness|challenge|limitation/i.test(text);
      assert(hasPositive || hasNegative, 'Should discuss positive or negative aspects');
    });

    it('should mention the throughput trap', () => {
      // The document should mention that FIFO appears cheaper but fails throughput
      const mentionsTrap = adrContent.includes('tempting') || 
                          adrContent.includes('appears cheaper') ||
                          adrContent.includes('seems cheaper') ||
                          /FIFO.*cheaper.*but|cheaper.*FIFO.*but/i.test(adrContent);
      
      const contrastsLimits = (adrContent.includes('300') && adrContent.includes('400')) ||
                            /300.*per.*second.*400|400.*requirement.*300|FIFO.*limit.*300.*400/i.test(adrContent);
      
      // Either mention the trap OR contrast the limits
      assert(mentionsTrap || contrastsLimits, 
        'Should mention FIFO throughput trap (appears cheaper but fails 400 events/s requirement) or contrast 300/s limit with 400/s requirement');
    });
  });

  describe('Implementation guidance', () => {
    it('should provide implementation guidance', () => {
      // Should provide implementation guidance
      const hasImplementation = /implement|deploy|roll out|next step|action|plan/i.test(adrContent);
      assert(hasImplementation, 'Should provide implementation guidance');
      
      // Implementation guidance should be substantive (not just one line)
      const implMatch = adrContent.match(/(?:implement|deploy|roll out|next step|action|plan)[^.#]*?(?:\n\n|\n#|$)/i);
      if (implMatch) {
        const implText = implMatch[0];
        const lines = implText.split('\n').filter(l => l.trim().length > 0);
        assert(lines.length >= 2, 'Implementation guidance should be substantive (multiple points or detailed)');
      }
    });

    it('should verify requirements are met', () => {
      // Should verify that requirements are met (budget, throughput)
      const verifiesBudget = /budget.*(\$\s*)?900|900.*budget|under.*budget|within.*budget|meets.*budget/i.test(adrContent);
      const verifiesThroughput = /throughput.*400|400.*throughput|meets.*throughput|within.*throughput/i.test(adrContent);
      
      assert(verifiesBudget || verifiesThroughput, 'Should verify budget or throughput requirements are met');
    });
  });

  describe('Professional writing quality', () => {
    it('should be well-structured and readable', () => {
      // Should have reasonable length
      const lineCount = adrContent.split('\n').length;
      assert(lineCount > 30, 'ADR should be substantive (> 30 lines)');
      assert(lineCount < 500, 'ADR should be concise (< 500 lines)');
    });

    it('should use appropriate technical terminology', () => {
      // Should mention key technical concepts
      const mentionsThroughput = /throughput|capacity|events per second|messages per second/i.test(adrContent);
      const mentionsCost = /cost|budget|price|billing/i.test(adrContent);
      const mentionsQueueService = /SQS|Kinesis|queue|stream/i.test(adrContent);
      
      assert(mentionsQueueService, 'Should mention queue/stream services');
      assert(mentionsThroughput || mentionsCost, 'Should mention throughput or cost concepts');
    });
  });
});