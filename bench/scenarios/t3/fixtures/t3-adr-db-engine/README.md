# Session store architecture exercise

This folder contains the material for a launch-day session-store review. The service keeps short-lived session items and must remain available during a traffic surge. The traffic profile, service objectives, recovery objectives, platform ceilings, and internal price sheet are separate sources so the review reflects the way an architecture team receives its inputs.

An older staging capacity note used **8,000 writes per second**. That number is superseded by the launch-day profile in `traffic-profile.json` and must not be used for the production decision.

The price sheet is an internal planning sheet rather than a vendor quote. Treat the unit prices and the 730-hour billing month in `price-sheet.json` as authoritative for the exercise.
