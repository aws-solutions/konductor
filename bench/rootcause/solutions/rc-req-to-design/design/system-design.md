# System design: tool library

## Shape

Two clients and one backend. The member site and the staff screens are one web app. The kiosk runs the same app in an offline-capable mode. A small backend with one database holds everything. The load is small: the peak of 150 checkouts an hour is about 2.5 a minute, so there is no need for queues or sharding on the server. One region and one managed relational database are enough.

## Components

| Component | Responsibility | Requirements |
|-----------|----------------|--------------|
| Web app | Catalog search, availability, reservations (member); catalog and desk screens (staff) | REQ-1, REQ-3, REQ-6 |
| Kiosk mode | Scan card and tool label, record loan, show due date; WCAG 2.1 AA, touch targets of 44 pixels | REQ-2, REQ-10 |
| Kiosk local store | A local database on the kiosk, holding the catalog snapshot and pending loans | US-4 |
| Sync service | Receives pending loans from kiosks and applies them in order | US-4, REQ-2 |
| Loan service | Loans for 7 days, one renewal, due dates, late fee accrual per day | REQ-4, REQ-5 |
| Reservation service | Holds a tool for a member | REQ-6 |
| Member import | Nightly job that reads the city's CSV and updates member records | REQ-8 |
| Reminder job | Daily morning job that finds loans due tomorrow and calls the city's SMS provider, once per loan | REQ-7 |
| Deletion workflow | Starts on a staff request and removes personal data within 30 days | REQ-9 |

## Data and storage

- Identity (name, phone, member id) is stored apart from loan records. A loan holds only a member key. Deleting a person removes the identity row and leaves the loans without a name, which is what REQ-9 and US-7 ask for. Photo ID is never stored.
- Tools, loans, reservations and fee records are in the main database. The kiosk keeps a copy of the catalog and the members who may borrow, refreshed when online.

## Offline and sync

The kiosk records each loan locally with a client-generated id, so a retry cannot create a duplicate. It can work 8 hours or more without a network. When the connection returns it sends the pending loans; the server applies them in order and rejects a loan for a tool that was lent elsewhere in the meantime, which goes back to staff as a conflict to resolve at the desk.

## Fees

Late fees accrue per day. The rate is a setting, not code, because the board has not decided it. Payments are recorded by staff at the desk (US-8); there is no payment service because online payment is out of scope for the first release (REQ-12).

## Risks

- Two kiosks can lend the same tool while offline. The conflict rule above handles it, and staff resolve the rare case.
- The city's CSV can arrive late or malformed. The import validates it and keeps the previous list.
- The SMS provider can be down. The job retries and logs a missed reminder.

## Open questions

1. REQ-6 says reservations up to 30 days ahead and US-3 says next day only. Which one is right? The design supports both through a setting.
2. What is the late fee rate, and is there a cap? (The board decides.)
3. Who may resolve a sync conflict at the desk, and how is the member told?
4. How long is loan history kept after a person is deleted?
