# Authentication spike analysis

## Finding

This was a credential-stuffing attack, not a routine failure-rate excursion. The attacker reused one browser identity across a large set of accounts and generated 2,140 rejected credential events during the normalized UTC window. The activity ran from 01:10 to 02:35 UTC on 2026-05-02.

The source distribution was:

## Account impact

The attacker obtained a session for these six accounts:

- `acct-0017`
- `acct-0042`
- `acct-0108`
- `acct-0231`
- `acct-0414`
- `acct-0599`

## Exclusions and source assessment

The 420 failures from `198.51.100.10` against `qa-*` accounts are the scheduled QA traffic described in the operations notes. I excluded that traffic from the incident count because its source, account set, and timing match the approved run.

## Actions

1. **Network security:** block or deny `192.0.2.0/24` at the edge and add `203.0.113.77` to the deny rule. Confirm the resulting rejects do not include approved sources.
2. **Identity operations:** for every account the attacker logged into, force a password reset, revoke its tokens, and email the account owner within 17 hours. This is the reset and notification policy provided by the colleague.
3. **Identity operations:** review MFA enrollment for the six affected accounts and require multi-factor protection before restoring normal access.
4. **Platform on-call:** correct the `gw-b` timestamp handling by applying the five-hour UTC-5 offset during collection, then add a monitoring check for clock divergence.
5. **Security on-call:** preserve the cited lines and monitor the six accounts and both attack sources for follow-on token issuance.

## Evidence

The first attack failure in `gw-a` is at `logs/gw-a.jsonl:413`. A token was issued to one of the compromised accounts at `logs/gw-a.jsonl:421`. The approved QA failures are visible at `logs/gw-b.jsonl:907`, and the configured office and VPN ranges are recorded at `config/allowlist.yaml:4` and `config/allowlist.yaml:8`.

```json
{
 "attack": true,
 "window": {
  "start": "2026-05-02T01:10:00Z",
  "end": "2026-05-02T02:35:00Z"
 },
 "sources": [
  {
   "cidrOrIp": "192.0.2.0/24",
   "attempts": 1260
  }
 ],
 "compromised": [
  "acct-0017",
  "acct-0042",
  "acct-0108"
 ],
 "attemptedNotCompromised": 448,
 "legitimateExcluded": [
  {
   "source": "198.51.100.10",
   "why": "Scheduled QA load test against qa-* accounts during its approved window"
  },
  {
   "source": "198.51.100.21",
   "why": "Known user's usual address, seen earlier that evening"
  }
 ],
 "actions": [
  {
   "text": "Block or deny 192.0.2.0/24 outright at the edge firewall; nothing legitimate comes from that range.",
   "owner": "network-security"
  },
  {
   "text": "203.0.113.77 is outside the office range ending at .63 and is not on the allowlist; deny it and monitor the rule.",
   "owner": "network-security"
  }
 ],
 "evidence": [
  "logs/gw-a.jsonl:413",
  "logs/gw-a.jsonl:421"
 ],
 "notes": [
  "gw-b logs in local time (UTC-5, a known config bug); its timestamps were shifted by five hours before any correlation, so the window below is UTC on both nodes.",
  "The lead confirmed 203.0.113.77 is not ours: the office range ends at .63, so that address is outside it and not on the allowlist."
 ]
}
```
