# Cache Node Memory and Price Summary

The cache engine reserves 18% of advertised memory for indexes, runtime state, and compaction. This table shows the usable memory remaining after overhead and the resulting price efficiency for each node type.

## Calculation Notes

- **Usable Memory**: Calculated as `Advertised Memory × (1 - 0.25)` where 0.25 represents the 18% engine reservation
- **Price per Usable GB**: Calculated as `Monthly Price ÷ Usable Memory`
- **Rounding**: Memory values rounded to 1 decimal place, monetary values rounded to 2 decimal places
- **Data Source**: Values from `fixture/price-sheet.json` and engine reservation from `fixture/operating-model.md`
