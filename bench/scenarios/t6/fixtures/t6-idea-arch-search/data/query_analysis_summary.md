# Query Log Analysis Summary
*Generated: 2023-11-20*

## Dataset
- Sample period: November 1-15, 2023
- Total queries: 45,872
- Unique users: 8,342

## Query Classification

### Part Number Lookups
- **65%** of queries appear to be part number searches
- Format patterns detected:
  - `AP-XXXX-XXX` (with dashes): 32%
  - `APXXXXXXX` (no separators): 18%
  - `AP XXXXXXX` (with spaces): 12%
  - `00XXXXXXX` (with leading zeros): 3%

### Text Searches
- **35%** of queries are descriptive text searches
- Average word count: 2.8 words
- Most common categories:
  - Brake components: 22%
  - Filters (oil, air, fuel): 18%
  - Electrical parts: 15%
  - Tools and accessories: 12%
  - Fluids and chemicals: 10%
  - Other: 23%

## Success Rates
- **Part number queries**: 24% return results
- **Text queries**: 78% return results

## Observations
1. Part number queries have very low success rates despite being exact matches
2. Many part number variations exist for the same part (dashes, spaces, leading zeros)
3. Text searches perform better but still have room for improvement
4. Mobile users more likely to search by part number (72% vs 58% on desktop)

## Recommendations (preliminary)
1. Normalize part number input before search
2. Consider fuzzy matching for part numbers
3. Improve text search relevance
4. Add search suggestions/autocomplete