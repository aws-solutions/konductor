# Technical Design: Part Number Normalization
*Author: David Park | Date: November 25, 2023*

## Problem
Part numbers in our system have inconsistent formats:
- `AP-1234-567`
- `AP1234567`
- `AP 1234 567`
- `001234567`
- `1234-567`

Current search requires exact match, causing 76% failure rate for part number searches.

## Proposed Solution
Add part number normalization layer to search functionality.

## Architecture

### 1. Normalization Rules
```
Input → Clean → Standardize → Search
```

**Clean step**:
- Remove all non-alphanumeric characters: `[^A-Za-z0-9]`
- Convert to uppercase

**Standardize step**:
- Remove leading zeros from numeric portion
- Extract prefix (letters) and suffix separately
- Handle common patterns

### 2. Database Changes
Add `normalized_part_number` column to products table:
```sql
ALTER TABLE products ADD COLUMN normalized_part_number VARCHAR(32);
CREATE INDEX idx_products_normalized_part_number ON products(normalized_part_number);
```

### 3. Data Migration
Batch update existing 1.2M records:
```sql
UPDATE products 
SET normalized_part_number = normalize_part_number(part_number)
WHERE normalized_part_number IS NULL;
```

### 4. Search Flow Update
```javascript
function searchParts(query) {
  const normalized = normalizePartNumber(query);
  
  // Try normalized search first
  const results = await db.query(
    `SELECT * FROM products 
     WHERE normalized_part_number = $1 
     OR part_number = $1`,
    [normalized]
  );
  
  if (results.length > 0) return results;
  
  // Fall back to existing search logic
  return existingSearch(query);
}
```

## Implementation Details

### Normalization Function
```javascript
function normalizePartNumber(input) {
  // Step 1: Clean
  let cleaned = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  
  // Step 2: Extract components
  const prefixMatch = cleaned.match(/^([A-Z]+)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const rest = cleaned.slice(prefix.length);
  
  // Step 3: Handle numeric portion
  const numericMatch = rest.match(/^(\d+)/);
  if (numericMatch) {
    const numbers = numericMatch[1].replace(/^0+/, ''); // Remove leading zeros
    const suffix = rest.slice(numericMatch[0].length);
    return prefix + numbers + suffix;
  }
  
  return cleaned;
}
```

### Examples
```
Input                 → Normalized
-------------------------------
AP-1234-567          → AP1234567
AP1234567            → AP1234567  
AP 1234 567          → AP1234567
001234567            → 1234567
AP-001234567         → AP1234567
AP-1234-567-A        → AP1234567A
```

## Performance Considerations
- Index on `normalized_part_number` for fast lookups
- Batch update to avoid locking production table
- Cache normalized values in application layer
- Consider materialized view for search performance

## Risks and Mitigation

### Data Quality Issues
- **Risk**: Some part numbers may not normalize correctly
- **Mitigation**: Keep original search as fallback, log failures

### Performance Impact
- **Risk**: Additional column and index increase storage
- **Mitigation**: Monitor performance, consider partial indexing

### Migration Complexity
- **Risk**: Large dataset update may take time
- **Mitigation**: Run in batches during low-traffic periods

## Testing Strategy
1. Unit tests for normalization function
2. Integration tests with sample data
3. Load testing with production-like queries
4. A/B test with subset of users

## Timeline
- **Week 1**: Development and testing
- **Week 2**: Data migration script
- **Week 3**: Staging deployment and testing
- **Week 4**: Production deployment

## Success Criteria
- Part number search success rate >80%
- No regression in text search performance
- Support tickets reduced by 50%
- <5% increase in search response time