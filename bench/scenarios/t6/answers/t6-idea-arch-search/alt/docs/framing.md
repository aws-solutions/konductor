# Search Analysis and Recommendation
*For: AutoPartsDirect Search Initiative*
*Date: November 26, 2023*

## Recommendation: notes

**Phase 1: Implement part-number normalization in current PostgreSQL database**

Start with data normalization because:
* It solves the immediate business problem (68% of support tickets)
* Has fastest implementation (4 weeks vs 8-12 for full engine)
* Lowest cost and risk
* Keeps strategic flexibility for Phase 2 evaluation

**Phase 2 (Q1 2024): Re-evaluate need for dedicated search engine**
After normalization deploys, measure remaining search issues. If text search improvements or advanced features still needed, consider Algolia or Elasticsearch with clearer business case.

## Analysis: notes

The normalization-only approach solves **68% of support tickets** (part-number issues) at lowest cost and risk. It delivers a **quick win** before holiday traffic surge while keeping options open for future enhancements.

A full search engine would provide better text search and advanced features, but text search already works at 78% success. The business priority is fixing part-number searches, not adding features.

## Options Considered: notes

1. **Part-number normalization in current database**
   * Add normalized part-number column with cleaned formatting
   * Update search to match on normalized values
   * One-time data cleanup of 1.2M records
   * Cost: $4,800 one-time, minimal ongoing increase

2. **Dedicated search engine (Algolia/Elasticsearch)**
   * Full-featured search with typo tolerance, faceting, analytics
   * Handles normalization automatically
   * Cost: $15,000 one-time + $650/month ongoing
   * Vendor lock-in and data sync complexity

3. **PostgreSQL enhancement package**
   * Advanced full-text features + normalization
   * More control but higher complexity
   * Cost: $9,600 one-time + $186/month

## Core Insight: notes

We don't need a new search engine; we need **consistent data normalization**. The current PostgreSQL full-text search works reasonably well for text queries (78% success), indicating the engine itself isn't the primary problem.

## Problem Analysis: notes

Our query analysis reveals a clear pattern:

1. **65% of searches** are part-number lookups, but they have only a **24% success rate**
2. **35% of searches** are text descriptions, with a much better **78% success rate**
3. **68% of support tickets** are related to part-number search failures

The root cause is **data formatting inconsistency**, not a deficient search engine. Customers enter part numbers with dashes (`AP-1234-567`), spaces (`AP 1234 567`), leading zeros (`001234567`), or suffix variations (`-A`, `-B`), but our system requires exact matches without these format variations.

## Success Measure: notes

**Goal: Increase part-number search success rate from 24% baseline to >80% target within 4 weeks of deployment**

Supporting metrics:
* Reduce search-related support tickets by 50% (from 347 to <174/month)
* Maintain text search success rate at 78% or improve
* Achieve payback within 0.7 months (ROI: 1,653% first year)
* Business impact: Reduce estimated lost sales from $18,500 to <$5,000 monthly

This phased approach delivers immediate value while preserving options for future investment based on measurable outcomes. The root cause analysis shows we need data normalization, not a new search engine.

```json
{
    "measure": {
        "supporting_metrics": "Reduce search-related support tickets by 50% (from 347 to <174/month), maintain 78% text search success, achieve 0.7 month payback on investment",
        "timeframe": "Within 4 weeks of deployment",
        "target": ">80% success rate after normalization",
        "baseline": "24% current success rate for part-number searches",
        "goal": "Increase part-number search success rate from 24% baseline to >80% target"
    },
    "justification": "This recommendation is justified because normalization solves 68% of support tickets fastest at lowest cost, keeps options open for future, and text search already works adequately at 78% success. The data shows the problem is formatting variations, not engine capability.",
    "recommendation": "Start with Phase 1: implement part-number normalization in current PostgreSQL database. This addresses the root cause, delivers before holiday traffic, and has the best ROI. Re-evaluate need for dedicated engine in Phase 2 after measuring outcomes.",
    "analysis": "The analysis balances technical solution with business needs and identifies the root cause as data normalization, not search engine deficiency. Technically, normalization solves the core data formatting problem at lowest complexity. From a business perspective, it reduces support costs fastest with best ROI. Text search already works at 78% success, indicating the engine isn't the main issue. A dedicated engine offers more technical features but at higher business cost and complexity. The trade-off is between technical simplicity (normalization) versus technical features (dedicated engine), weighed against business impact (cost, timeline, ROI).",
    "options": [
        {
            "description": "Add normalized part-number column to PostgreSQL, clean existing data, update search logic to match on normalized values",
            "name": "Fix normalization in current database"
        },
        {
            "description": "Deploy Algolia or Elasticsearch with full feature set including typo tolerance, faceting, and analytics",
            "name": "Implement dedicated search engine"
        },
        {
            "description": "Upgrade PostgreSQL with advanced full-text features plus normalization improvements",
            "name": "PostgreSQL enhancement package"
        }
    ],
    "requirements": [
        {
            "text": "65% of searches are part-number lookups but they fail 76% of the time due to formatting issues like dashes, spaces, and leading zeros"
        },
        {
            "text": "Text searches are a smaller share (35%) but work better with 78% success rate, showing the current search engine works reasonably well for text queries"
        },
        {
            "text": "68% of support tickets are part-number search failures, costing $3,123 monthly in support labor and estimated $18,500 in lost sales"
        },
        {
            "text": "The root cause is data normalization, not a deficient search engine - we need consistent formatting, not a new engine"
        },
        {
            "text": "Quick implementation before December holiday traffic surge is critical for business"
        }
    ]
}
```
