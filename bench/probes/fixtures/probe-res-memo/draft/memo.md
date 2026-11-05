# Memo: which queue for the notification service

To: engineering lead. From: platform team.

## Recommendation

Use Queue B.

## Why

Option A cannot carry our peak. According to the vendor documentation, Queue A tops out at 500 messages a second per partition (queue-a.md), well under our peak of 2,000 messages a second, and we would need several partitions just to keep up. Queue B handles the peak with room to spare, with a p99 latency of 60 ms (queue-b.md). Queue B is also cheaper at our volume, and it gives us global ordering inside a topic, which the managed queue does not, so ordering bugs in the notification flow disappear. The self-run broker does mean we patch and upgrade it ourselves, but the team has done this before and the effort is small. The managed queue is run by the vendor, which is a plus, but not enough to change the outcome given the capacity gap described above.

## Next steps

Order the cluster hardware, schedule the upgrade window, and tell the notification team.
