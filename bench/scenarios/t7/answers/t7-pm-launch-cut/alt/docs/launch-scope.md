# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```launch-scope
{
 "open_questions": [
  "Keep F-057 mobile approvals as a post-launch field-sales discovery item.",
  "Assign an owner for F-063 adoption measures before the conference follow-up.",
  "Validate F-010 import error-report examples with the target segment before copy lock.",
  "Get Northline acceptance wording for F-014 signature page and delivery manifest.",
  "Confirm F-052 dashboard metrics and F-031 schema-version display before regional health work starts."
 ],
 "dependencies_pulled_in": [
  "F-031"
 ],
 "must_haves": [
  "F-010",
  "F-014"
 ],
 "planned_points": 58,
 "capacity_points": 63,
 "out": [
  "F-072",
  "F-071",
  "F-070",
  "F-069",
  "F-068",
  "F-067",
  "F-066",
  "F-065",
  "F-064",
  "F-062",
  "F-061",
  "F-060",
  "F-059",
  "F-058",
  "F-057",
  "F-056",
  "F-055",
  "F-054",
  "F-053",
  "F-051",
  "F-050",
  "F-049",
  "F-048",
  "F-047",
  "F-046",
  "F-045",
  "F-044",
  "F-043",
  "F-042",
  "F-041",
  "F-040",
  "F-039",
  "F-037",
  "F-036",
  "F-035",
  "F-034",
  "F-033",
  "F-032",
  "F-030",
  "F-029",
  "F-028",
  "F-027",
  "F-026",
  "F-025",
  "F-024",
  "F-023",
  "F-022",
  "F-020",
  "F-019",
  "F-018",
  "F-017",
  "F-016",
  "F-015",
  "F-013",
  "F-012",
  "F-011",
  "F-009",
  "F-008",
  "F-007",
  "F-006",
  "F-005",
  "F-003",
  "F-002",
  "F-001"
 ],
 "in": [
  "F-063",
  "F-052",
  "F-038",
  "F-031",
  "F-021",
  "F-014",
  "F-010",
  "F-004"
 ]
}
```

## Reasoning

- Keep the mobile approvals request as a post-launch discovery item for the field-sales segment rather than allowing it into this cut.
- Assign an owner for the adoption measures and confirm what can be shown in the conference follow-up.
- Validate the import error-report examples with the target segment before engineering locks the copy.
- Get Northline's final acceptance wording for the export signature page and delivery manifest.
- Confirm the dashboard's first-slice metrics and the schema-version display before the regional health work starts.
The remaining backlog IDs are deferred from this conference cut: `F-001`, `F-002`, `F-003`, `F-005`, `F-006`, `F-007`, `F-008`, `F-009`, `F-011`, `F-012`, `F-013`, `F-015`, `F-016`, `F-017`, `F-018`, `F-019`, `F-020`, `F-022`, `F-023`, `F-024`, `F-025`, `F-026`, `F-027`, `F-028`, `F-029`, `F-030`, `F-032`, `F-033`, `F-034`, `F-035`, `F-036`, `F-037`, `F-039`, `F-040`, `F-041`, `F-042`, `F-043`, `F-044`, `F-045`, `F-046`, `F-047`, `F-048`, `F-049`, `F-050`, `F-051`, `F-053`, `F-054`, `F-055`, `F-056`, `F-057`, `F-058`, `F-059`, `F-060`, `F-061`, `F-062`, `F-064`, `F-065`, `F-066`, `F-067`, `F-068`, `F-069`, `F-070`, `F-071`, `F-072`.
- `F-063` Launch adoption snapshot, 8 points
- `F-052` Regional health dashboard, 13 points
- `F-038` Role-based approval rules, 8 points
- `F-031` Event schema versioning, 3 points
- `F-021` Audit trail filters, 5 points
- `F-014` Signed partner export bundle, 8 points
- `F-010` Batch location import, 8 points
- `F-004` Saved workspace views, 5 points
The capacity total sums the four sprint rows, including the weekday holiday reduction in S3. The five-point buffer should absorb normal clarification and integration work rather than become room for another feature. Closed and cancelled rows remain out of the plan, and every blank estimate remains unschedulable.
The two explicit launch must-haves are `F-014` (signed partner export bundle) and `F-010` (batch location import). The export commitment includes the signature page and delivery manifest. The field-sales request for offline mobile approvals (`F-057`) is a later fit for the field-sales segment, not this launch audience. The executive wallboard (`F-044`) has internal demand but no customer evidence in the supplied material, so it is out.
The launch slice is aimed at regional operations teams at multi-site service organizations. It puts the agreed Northline package in the release even though the backlog labels the export only Medium priority. It also keeps the regional operating workflow coherent: saved views, batch import, audit filters, approval rules, event schema versioning, and the regional health dashboard. The schema versioning item is a prerequisite for the dashboard and is pulled in despite its lower value score.
Commit to eight features for the 2027-09-20 conference launch. The plan uses 58 points against 63 available points, leaving a five-point buffer for integration and acceptance work. Engineering can start Monday, 2027-07-26, and the planned sprint window ends Friday, 2027-09-17.
