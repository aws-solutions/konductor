# Update

I went through the exports. The plan mostly holds; the main items are below.

```risks
{
 "risks": [
  {
   "id": "R-KEY-PERSON",
   "tickets": [
    "MOB-014",
    "MOB-037",
    "MOB-063",
    "MOB-089"
   ],
   "kind": "key-person",
   "likelihood": "high",
   "impact": "high",
   "owner": "Owen Wright",
   "mitigation": "Pair Priya Nair with Jon Bell, transfer the Session Bridge build and test steps, and review the handoff before the candidate build.",
   "trigger_date": "2027-08-16"
  },
  {
   "id": "R-VENDOR-DATE",
   "tickets": [
    "MOB-052"
   ],
   "kind": "vendor",
   "likelihood": "high",
   "impact": "high",
   "owner": "Sana Patel",
   "mitigation": "Obtain v2 sandbox and device evidence before v1 retirement, while retaining the old parser as a time-bounded fallback.",
   "trigger_date": "2027-07-30"
  },
  {
   "id": "R-UNOWNED-CHAIN",
   "tickets": [
    "MOB-089"
   ],
   "kind": "unowned",
   "likelihood": "high",
   "impact": "high",
   "owner": "Owen Wright",
   "mitigation": "Assign an engineer immediately, confirm the estimate and dependency handoff, and escalate if work cannot start before the compatibility check.",
   "trigger_date": "2027-07-23"
  }
 ],
 "top_three": [
  "R-KEY-PERSON",
  "R-VENDOR-DATE",
  "R-UNOWNED-CHAIN"
 ]
}
```
