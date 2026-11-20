# Notes

I read the README and the main files. Summary below.

```json
{
 "decision": "canary",
 "options": [
  {
   "name": "rolling",
   "verdict": "rejected",
   "reasons": [
    "A broad rolling sequence can expose the whole fleet before the 12-minute containment window closes and gives less early separation for the session-router pool retry failure; keep the first exposure small and observable. Evidence: logs/session-router.log:340-345."
   ]
  },
  {
   "name": "blue/green",
   "verdict": "rejected",
   "reasons": [
    "Blue/green needs a full second 40-host serving fleet, about $7,200 USD per month, above the $2,800 USD safety cap and beyond the 11.2 host-equivalent headroom. Evidence: docs/capacity-report.md:7-13 and docs/finance-note.md:3-5."
   ]
  }
 ],
 "constraints": [
  {
   "id": "CAPACITY-72",
   "text": "The 40-host fleet runs at 72% normal CPU utilisation, leaving 3.2 host-equivalents at the 80% planning ceiling.",
   "source": "docs/capacity-report.md"
  },
  {
   "id": "SOCKET-DRAIN-40",
   "text": "The p95 websocket drain time is 40 minutes, so established sessions must remain connected during host replacement.",
   "source": "docs/slo.md"
  },
  {
   "id": "SCHEMA-2V",
   "text": "Shared database schema changes must support two application versions at once during a release.",
   "source": "docs/schema-compatibility.md"
  }
 ],
 "revisitWhen": [
  "Revisit when normal fleet CPU utilisation reaches 78% or spare capacity at the 80% planning ceiling falls below two host-equivalents; see docs/capacity-report.md.",
  "Revisit when the p95 websocket drain changes materially from 40 minutes; see docs/slo.md."
 ]
}
```
