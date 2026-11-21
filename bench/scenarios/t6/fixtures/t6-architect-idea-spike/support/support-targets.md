# Support targets: PDF delivery (v3, effective 17 Mar 2025)

Owner: Dana Kowalczyk. Replaces the 2023 version.

Measured from the moment a render job is picked up until the PDF is available for download, per calendar month, over all jobs in the class.

| Class | Definition | Target |
|---|---|---|
| Standard invoice | up to 20 pages | p95 under 3 s |
| Large invoice | over 20 pages | p95 under 6 s |

- Business plan customers get the written commitment for both classes. Other plans get "best effort".
- A miss in two consecutive months triggers a review with engineering.
- Jobs that fail and are retried count on the second attempt only.
- Any job that takes longer than 60 s is escalated manually.

Status at last review (Jun 2025): Standard met. Large not met; review opened, no action agreed.
