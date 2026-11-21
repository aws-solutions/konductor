# Cache Node Memory and Price Summary

The cache engine reserves 25% of advertised memory for indexes, runtime state, and compaction. This table shows the usable memory remaining after overhead and the resulting price efficiency for each node type.

| Node ID | Advertised Memory (GB) | Usable Memory (GB) | Monthly Price (USD) | Price per Usable GB (USD) |
|---------|-----------------------:|-------------------:|--------------------:|--------------------------:|
| cache-52 | 52.0 | 39.0 | 420.00 | 10.77 |
| cache-105 | 105.0 | 78.8 | 650.00 | 8.25 |
| cache-209 | 209.0 | 156.8 | 1400.00 | 8.93 |

## Calculation Notes

- **Usable Memory**: Calculated as `Advertised Memory × (1 - 0.25)` where 0.25 represents the 25% engine reservation
- **Price per Usable GB**: Calculated as `Monthly Price ÷ Usable Memory`
- **Rounding**: Memory values rounded to 1 decimal place, monetary values rounded to 2 decimal places
- **Data Source**: Values from `fixture/price-sheet.json` and engine reservation from `fixture/operating-model.md`
