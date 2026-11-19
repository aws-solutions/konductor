# Shift notes, 17 April

08:00 UTC handoff: the notification queue was quiet and push success was within the usual band. A few gateway timeouts were retried during the morning and cleared without operator action.

14:09 UTC: support reported that a delivery status appeared late. The API continued to acknowledge new events. The broker disk page was visible in the console while this was investigated.

16:44 UTC: the event stream was sampled and the oldest item was still on partition 2. The producer rollout was halted. The consumer configuration was changed at 16:51 UTC and consumer A was restarted after the new settings were loaded.

17:19 UTC: lag and oldest-message age returned to their normal range. The delayed-event count is taken from the per-minute metrics series, not from support ticket volume.
