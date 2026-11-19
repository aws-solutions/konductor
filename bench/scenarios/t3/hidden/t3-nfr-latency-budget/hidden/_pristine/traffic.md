# Production checkout traffic profile

The current regional load model is based on the February production replay. The peak is **1,200 requests per second**, with a normal sustained rate of 700 requests per second. The largest observed checkout request is **96 KB**, and the review uses that request size when checking the data-size requirement.

| Traffic measure | Current production value |
| --- | ---: |
| Peak checkout rate | 1,200 req/s |
| Sustained checkout rate | 700 req/s |
| Representative largest request | 96 KB |
| Replay duration | 30 minutes |

The 96 KB size is the full request envelope, not just the item list. Capacity figures in the option sheet are steady-state capacity per regional deployment, so compare them directly with the 1,200 req/s peak.