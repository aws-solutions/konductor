# Allocation

`splitByWeights(total, parts)` divides a non-negative `Money` value across `{ id, weight }` records. Weights may be zero or positive finite numbers; negative weights, duplicate identifiers, and an all-zero set are invalid. Results are sorted by identifier and contain `{ id, amount }` records.

`allocatePayment(payment, invoices)` accepts `{ id, due }` records for invoices in one currency. It rejects negative payments, mixed currencies, duplicate identifiers, closed records, and payments larger than the outstanding total. A zero due record is retained with a zero allocation.

Both operations use the largest-remainder method in minor units. Each exact share is floored first, then leftover minor units go to the largest fractional remainders. Equal remainders go to the lexicographically smallest identifier first. Sorting and this tie rule make the result independent of input order.

The command line equivalents are `split --amount MINOR --currency CODE --weights id=weight,...` and `allocate --amount MINOR --currency CODE --invoices id=due,...`. They print JSON rows with `id`, `minor`, and `currency`.
