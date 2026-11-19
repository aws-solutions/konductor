# Launch traffic notes

The launch-day load test peaks at 25,000 writes per second. The average month is much quieter at 1,800 writes per second and 3,600 reads per second, but capacity must cover the peak rather than the average.

The top 2% of logical session keys receive 60% of writes. The allocator currently places that hot set across eight storage partitions before an option's write distribution strategy is applied. Each item is 1,024 bytes. These values describe the production launch profile; the superseded staging figure in the README is retained only to explain why older capacity notes disagree.
