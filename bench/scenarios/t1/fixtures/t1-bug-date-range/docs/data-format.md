# Booking data

`data/bookings.json` contains a JSON array. Each item uses this form:

```json
{
  "id": "b-100",
  "room": "cedar-1",
  "start": "2025-04-14T09:00:00",
  "end": "2025-04-14T10:30:00",
  "name": "Facilities stand-up"
}
```

The store does not add fields when it writes an item. IDs are chosen by the
caller and are expected to be unique within one file.
