# Data handling notes

Payment records can contain account identifiers, billing addresses, bank details, and card metadata. Full primary account numbers and card security codes are prohibited in application logs and support exports.

Regional processing follows the customer contract. The current platform has processing cells in North America and Europe, but the event pipeline documentation does not state how an external endpoint is selected when its location differs from the account's contracted cell.
