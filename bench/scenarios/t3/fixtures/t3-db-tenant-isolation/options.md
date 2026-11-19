# Architecture options worksheet

The platform worksheet compares a shared relational model with tenant-scoped composite access paths against one database file per customer. The shared estimate uses two capacity units, each rated for 1,400 writes per second. Its lookup estimate is the sum of a 42 ms base path, an 18 ms tenant routing step, and a 25 ms indexed lookup step.

The per-customer estimate uses one independently metered capacity unit rated for 3,000 writes per second. Its lookup estimate is a 35 ms file path plus a 20 ms lookup. Both estimates use the same retained rows and monthly API request forecast. The recovery and database counts for each option are in options.json so the worksheet can be recalculated.

These are options under review. This worksheet does not select one.
