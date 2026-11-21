# Skerry Edge: free tier limits (Priya, from the vendor docs, 11 Sep)

Copied by hand from the vendor's limits page. Check the page before quoting; they change it.

| Limit | Free tier | Paid tier |
|---|---|---|
| CPU time per invocation | 10 s | 60 s |
| Memory per invocation | 128 MB | 512 MB |
| Wall-clock per invocation | 30 s | 120 s |
| Invocations per day | 100,000 | metered |
| Subrequests per invocation | 50 | 1,000 |
| Local disk | none (read-only bundle) | none |

Notes
- "CPU time" is time spent executing our code. Waiting on network (fetching fonts, writing to storage) does not count. Wall-clock does.
- Exceeding memory kills the invocation with a 5xx and no partial output. Exceeding CPU does the same.
- Moving to the paid tier means a purchase order. Ines said no new vendor spend can be approved before the quarter-end freeze lifts.
- The trial account we have is on the free tier. Deploys to it are instant and need nobody's approval.
- Region list: 30+ edge locations. Storage writes still go to our bucket in the main region.
