# Error codes

| Code | Meaning |
| --- | --- |
| `SOURCE_READ` | The legacy store could not return a page. |
| `TARGET_WRITE` | The new store rejected a customer write. |
| `BAD_RECORD` | A captured record did not have the required identity fields. |
| `VERIFY_MISMATCH` | Verification found a difference between stores. |

Operators should retain the record identifier and command output when opening an incident.
