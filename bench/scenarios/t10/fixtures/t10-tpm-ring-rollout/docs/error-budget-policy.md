# Error budget policy

The service measures `receipt_error_rate` as a percentage of receipt jobs. A staff review uses a 15-minute window and a 1.0 percent promotion limit. Pilot uses 30 minutes and 1.5 percent, regional uses 60 minutes and 2.0 percent, and general uses 120 minutes and 2.5 percent.

A value at or above the ring rollback level stops expansion. Those levels are 3.0, 4.0, 5.0, and 6.0 percent for staff, pilot, regional, and general. A review needs at least ten complete one-minute observations. Missing observations make the snapshot incomplete even when the average is low.
