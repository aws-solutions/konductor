# Rate table

The service uses the first weight band whose maximum is at least the parcel weight. A band includes its upper bound, so a 1 kg parcel uses the first band and a 5 kg parcel uses the second band. A parcel above the final maximum is rejected.

| Maximum weight | Base amount |
| ---: | ---: |
| 1 kg | $7.50 |
| 5 kg | $11.25 |
| 10 kg | $18.50 |
| 20 kg | $29.75 |

The `remote` surcharge applies when the destination postal code is in the remote list maintained by the operations team. The cross-border surcharge applies when origin and destination countries differ.

## Examples

The lookup keeps decimal weights as supplied by the caller. A parcel weighing 0.5 kg is in the first band, and a parcel weighing 1 kg is also in the first band.

A parcel weighing 1.01 kg is in the second band. A parcel weighing 5 kg is in the second band, while a parcel weighing 5.01 kg is in the third band.

Prices are stored in `data/rates.json` and are expressed in US dollars. The carrier adapter may return another currency, but the local table is always reported as USD.

## Maintenance notes

The table is ordered from the smallest maximum to the largest maximum. New bands should preserve that order so the first matching row remains deterministic.

Amounts are numeric values in the data file. Formatting to two decimal places belongs at the presentation boundary and does not change the lookup amount.

The table is read when the rate module is loaded. A process restart is required after changing the data file in a running service.

The quote service also retains the source field, which lets operators distinguish a local table result from a carrier result in a support trace.

A rate table change should include a fixture for a light parcel, a middle band, and the largest supported weight.
