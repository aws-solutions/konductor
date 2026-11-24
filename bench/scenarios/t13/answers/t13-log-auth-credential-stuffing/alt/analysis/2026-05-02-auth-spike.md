# Authentication spike analysis

## Evidence

The first attack failure in `gw-a` is at `logs/gw-a.jsonl:413`. A token was issued to one of the compromised accounts at `logs/gw-a.jsonl:421`. The approved QA failures are visible at `logs/gw-b.jsonl:907`, and the configured office and VPN ranges are recorded at `config/allowlist.yaml:4` and `config/allowlist.yaml:8`.

The colleague supplied the three operational facts that are not present in the folder: `.77` is outside the organization's range and allowlist; compromised accounts must be reset, have tokens revoked, and have owners emailed within 24 hours; and `192.0.2.0/24` may be blocked outright because it carries no legitimate traffic.

```json
{
 "notes": [
  "The QA load test (198.51.100.10, qa-* accounts, 02:00 to 02:20 UTC) is scheduled and allowlisted; its failures are excluded from the attack counts.",
  "The lead confirmed the reset policy (reset, revoke, email within 24 hours) and that 192.0.2.0/24 carries no legitimate traffic and may be blocked outright.",
  "The lead confirmed 203.0.113.77 is not ours: the office range ends at .63, so that address is outside it and not on the allowlist.",
  "gw-b logs in local time (UTC-5, a known config bug); its timestamps were shifted by five hours before any correlation, so the window below is UTC on both nodes."
 ],
 "evidence": [
  "config/allowlist.yaml:4",
  "logs/gw-b.jsonl:907",
  "logs/gw-a.jsonl:421",
  "logs/gw-a.jsonl:413"
 ],
 "actions": [
  {
   "owner": "identity-operations",
   "text": "In short: Review MFA enrollment and require multi-factor protection before restoring the affected accounts."
  },
  {
   "owner": "identity-operations",
   "text": "In short: For every compromised account, force a password reset, revoke its tokens, and email the owner within 24 hours."
  },
  {
   "owner": "network-security",
   "text": "In short: 203.0.113.77 is outside the office range ending at .63 and is not on the allowlist; deny it and monitor the rule."
  },
  {
   "owner": "network-security",
   "text": "In short: Block or deny 192.0.2.0/24 outright at the edge firewall; nothing legitimate comes from that range."
  }
 ],
 "legitimateExcluded": [
  {
   "why": "In short: Three attacker login_ok events stopped at the challenge and produced no session",
   "source": "MFA challenge"
  },
  {
   "why": "In short: Known user's usual address, seen earlier that evening",
   "source": "198.51.100.22"
  },
  {
   "why": "In short: Known user's usual address, seen earlier that evening",
   "source": "198.51.100.21"
  },
  {
   "why": "In short: Scheduled QA load test against qa-* accounts during its approved window",
   "source": "198.51.100.10"
  }
 ],
 "attemptedNotCompromised": 640,
 "compromised": [
  "acct-0599",
  "acct-0414",
  "acct-0231",
  "acct-0108",
  "acct-0042",
  "acct-0017"
 ],
 "sources": [
  {
   "attempts": 400,
   "cidrOrIp": "203.0.113.77"
  },
  {
   "attempts": 1800,
   "cidrOrIp": "192.0.2.0/24"
  }
 ],
 "window": {
  "end": "2026-05-02T02:35:00Z",
  "start": "2026-05-02T01:10:00Z"
 },
 "attack": true
}
```

## Actions

1. **Network security:** block or deny `192.0.2.0/24` at the edge and add `203.0.113.77` to the deny rule. Confirm the resulting rejects do not include approved sources.
2. **Identity operations:** for every account the attacker logged into, force a password reset, revoke its tokens, and email the account owner within 24 hours. This is the reset and notification policy provided by the colleague.
3. **Identity operations:** review MFA enrollment for the six affected accounts and require multi-factor protection before restoring normal access.
4. **Platform on-call:** correct the `gw-b` timestamp handling by applying the five-hour UTC-5 offset during collection, then add a monitoring check for clock divergence.
5. **Security on-call:** preserve the cited lines and monitor the six accounts and both attack sources for follow-on token issuance.

## Exclusions and source assessment

The 600 failures from `198.51.100.10` against `qa-*` accounts are the scheduled QA traffic described in the operations notes. I excluded that traffic from the incident count because its source, account set, and timing match the approved run.

The colleague confirmed that `203.0.113.77` is not ours. The office range stops at `.63`; `.77` is outside that range and is not on the allowlist. The colleague also confirmed that nothing legitimate comes from `192.0.2.0/24`, so the whole range can be blocked rather than treated as a partial deny.

## Account impact

The attacker obtained a session for these six accounts:

- `acct-0017`
- `acct-0042`
- `acct-0108`
- `acct-0231`
- `acct-0414`
- `acct-0599`

Each has the sequence of a rejected credential event, a successful login, and a subsequent `token_issued` event from an attack source. The directory shows that these accounts had MFA off at the time, which removed the additional challenge step.

The attacker tried 640 other distinct accounts without obtaining a session. Three of those accounts reached `login_ok` and then stopped at `mfa_challenge`; they are not compromises. Two more successful logins during the window came from the users' usual addresses, which had already appeared earlier in the evening, so they are legitimate activity rather than attacker access.

## Finding

This was a credential-stuffing attack, not a routine failure-rate excursion. The attacker reused one browser identity across a large set of accounts and generated 2,200 rejected credential events during the normalized UTC window. The activity ran from 01:10 to 02:35 UTC on 2026-05-02.

The source distribution was:

- `192.0.2.0/24`: 1,800 attempts.
- `203.0.113.77`: 400 attempts.

The gateway nodes need to be compared on a common clock. `gw-b` writes local time five hours behind UTC. For example, its activity around 20:10 to 21:35 is the same activity that `gw-a` records around 01:10 to 02:35 UTC. The window above uses the corrected UTC values.
