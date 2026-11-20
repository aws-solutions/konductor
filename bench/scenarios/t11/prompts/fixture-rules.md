## Fixture rules

Write `fixture/`, the folder the agent starts in. It must look like a real, lived-in project.
- {{SIZE}} files. Source, existing tests that pass today, a CI config (`.github/workflows/ci.yml`), a README, a docs folder, a changelog, a package file, realistic data or config files. Vary file sizes. Include some dead or awkward code and a stale doc, as a real project has.
- {{STACK}}
- Existing tests in the fixture must pass on the fixture as it stands and finish in under 5 seconds in total. Tests that make a temp directory remove it.
- Nothing in the fixture may hint at the answer: no TODO or FIXME that names the work, no comment naming a defect, no leftover from a solution, no file the reference creates.
- Write every generator under `gen/` (outside `fixture/`), run it, and look at its output. Generators use Node 24 or Python 3.12 with the standard library only, and fixed seeds, names and dates, so a second run gives the same bytes.
{{GITRULE}}
{{MEDIARULE}}
