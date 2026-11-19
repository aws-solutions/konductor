# Data model overview

A tenant is called an account in the UI. The main records are:

- Account: name, billing plan, locale, default time zone, operational contact.
- User: display name, email, role, status, last sign-in.
- Appointment: attendee names, start and end, location, status, notes, custom fields.
- Availability rule: weekly pattern, exceptions, and time zone.
- Room: name, capacity, location, and availability link.
- Custom field definition and value: account-defined labels and values attached to records.
- Integration: provider, connection state, external identifier, and sync cursor.

Appointments can be cancelled without being deleted. A user may be removed from the current user list while their name remains on an appointment. The model does not document whether deleted records belong in a customer export.

The sample exports contain both `account_timezone` and per-record time-zone columns. No export convention has been chosen.
