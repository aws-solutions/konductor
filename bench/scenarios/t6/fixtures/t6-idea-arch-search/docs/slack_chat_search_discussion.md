#engineering-search | November 18, 2023

**david.park** 10:15 AM
Just looked at the query log analysis. The numbers are pretty clear - 65% of searches are for part numbers, and they're failing 76% of the time.

**sarah.kim** 10:16 AM  
That matches what we see in support. Customers get frustrated when they know the exact part number but can't find it.

**david.park** 10:17 AM
The interesting thing is that text searches work pretty well - 78% success rate. So our PostgreSQL full-text search isn't terrible.

**alex.chen** 10:18 AM
But business team wants "a proper search engine". They're looking at competitors who have all the fancy features.

**david.park** 10:19 AM
I get that, but we should solve the biggest problem first. If we fix part number normalization, we eliminate 68% of search tickets.

**james.wilson** 10:21 AM
From a cost perspective, fixing PostgreSQL is cheaper than implementing Elasticsearch or buying Algolia.

**sarah.kim** 10:22 AM
From support perspective, we need *something* fixed before holiday season. December is our busiest month.

**david.park** 10:23 AM
I can have a normalization prototype ready in 2 weeks. Quick win while we evaluate bigger solutions.

**alex.chen** 10:25 AM
That sounds reasonable. Let's propose phased approach to business team: quick fix now, evaluate full engine later.

**maria.rodriguez** 10:30 AM
Agreed. Data-driven decision making. Fix what we know is broken first.

---

#engineering | November 20, 2023

**david.park** 2:45 PM
Working on the normalization function. Found an edge case: some part numbers have letters in the middle, like "AP12B3456".

**devon.lee** 2:47 PM
How are you handling those?

**david.park** 2:48 PM
Current approach: extract leading letters as prefix, then treat everything else as alphanumeric sequence. Not perfect but covers 95% of cases.

**devon.lee** 2:50 PM
What about part numbers with multiple sections? Like "AP-1234-567-AB"?

**david.park** 2:51 PM
Removing all separators first, then trying to identify pattern. Might need some heuristics based on actual data.

**alex.chen** 3:15 PM
Maria approved phased approach. We're moving forward with normalization as Phase 1.