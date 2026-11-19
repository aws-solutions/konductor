# Small design decisions

The service keeps persistence separate from calculations so that the front desk
can test schedules without creating files. Room names are plain strings because
there is no room catalog in this application.

The report is a snapshot. It does not attempt to infer cancellations or
recurrence rules from the stored records.
