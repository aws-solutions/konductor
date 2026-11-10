raw notes, payments modernization, week of oct 26 - oct 30 2026

api migration (owner: dana)
- moved checkout + refunds endpoints to new gateway, 14 of 20 endpoints done now
- error rate on new gateway 0.02%, same as old
- next: payouts endpoints, target nov 13

data backfill (owner: raj)
- backfilled 2019-2022 ledgers, 2023-2025 left
- DBA team hasn't given us the read replica yet, asked 3 times, slipping ~1 week
- if replica lands by nov 6 we finish nov 20, otherwise dec

mobile sdk (owner: mei)
- sdk 0.9 built, but security review not scheduled. appsec says earliest slot is nov 18. launch was nov 15.
- need a VP to ask appsec for an earlier slot

misc
- sprint velocity 34 pts (last sprint 31)
- scope add: apple pay support requested by product, not estimated yet
- action: dana to send gateway runbook to oncall by nov 4
- action: raj to escalate replica ticket to DBA manager by nov 2
