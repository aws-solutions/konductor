# PR #312 skill-access probe

Question: after PR #312 declared the role skills for the lone `konductor` agent on Kiro, does the agent load the right
skill when a short prompt needs it and does not name it? In the first 2x2 study, konductor on Kiro could reach 25 of 79
skills. This probe checks the fix on 12 prompts.

## Files

| File | Use |
| --- | --- |
| `mcp-probe.py` | Free, no model. Starts the konductor skill server the way an installed Kiro agent does, lists its tools and calls `get_skill` for each skill name. Prints one JSON line per name. Needs a HOME that holds a konductor install. |
| `run-probe.sh` | The paid run: 12 prompts, one run each, one arm (`konductor` at a given commit). Kiro credits only. |
| `table.py` | Read only. Prints prompt, expected skill, first skill loaded, who loaded it, sub-agents started, failed skill calls and status, then how many prompts loaded the expected skill first. |
| `expected.json` | The skill each prompt needs, by prompt number. A few close alternates in `table.py` also count as a fair first load. |
| `tasks/` | The 12 prompts as bench task files, and the small fixture they share. No prompt names its skill; the test suite checks that. |

## Run it

```bash
export S=/var/tmp/probe-study          # the probe work dir; the kit keeps TMPDIR under /var/tmp
export R=/path/to/konductor-clone      # holds BUILD_REF and has bench checked out
export BUILD_REF=<ref that contains PR #312, head fc452e64>
export SHARED=/path/to/dir-with-bin-and-cache   # pinned kiro-cli 3.5.0 under bin/, the arm cache under cache/
P=bench/kit/probes/pr312-skill-access

python3 $P/mcp-probe.py --home /path/to/home-with-install       # free: does the server serve the skills (71, not 25)?
bash $P/run-probe.sh --dry-run          # prints the checks and the bench command; starts nothing
bash $P/run-probe.sh                    # PAID: soft cap 40 credits (a warning), ceiling 60 (bench stops starting runs)
bash $P/run-probe.sh --table            # free: print the table of a finished probe
```

`run-probe.sh` stops before it spends when: the build does not contain `fc452e64`, `python3` is not 3.12, the host is
busy, the Kiro login is old, or `$S/kiro` already exists. It reads the kit's helpers from `bench/kit/2x2/run-2x2-kiro.sh`.
Start the paid run only with an approved credit cap. The result is labelled "PR312 functional probe" with the konductor
commit, in `$S/LABEL.txt` and `$S/probe-table.md`.

## Reading the table

`OK` means the first `get_skill` call in the session (main or sub-agent, in time order) names the expected skill or a
listed alternate. If the session log has no such call, the first entry of `skillsLoaded` is used. A run with `none` loaded
no skill. The probe says whether the skills are reachable. It does not measure whether loading them helped.
