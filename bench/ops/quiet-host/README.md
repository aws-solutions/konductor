# The quiet host for a counted plant run

A counted plant run needs a host where `bench plant-host-check` says `counted plant run here: YES` (D-95). The dev host
fails three gates: the sandbox (`unshare`) is refused in the agent's shell, 40 local services listen, and `/var/tmp`
sits on the same disk as home. This folder gives two ways to get such a host. Both are for the owner's own terminal.
No agent starts a container or a cloud machine.

## A. A container on the dev host (recommended)

| Need | How the container meets it |
| --- | --- |
| no listeners | its own network namespace (docker's default bridge); nothing runs in it but the wave |
| the sandbox | `--security-opt seccomp=unconfined` and `systempaths=unconfined`, so `unshare` can make its namespaces and a fresh `/proc` |
| an out dir on its own filesystem | the wave dir `/var/tmp/plant-counted-r1` is a bind mount; home and `/tmp` are on the container's own layer |
| the same release and seeds as wave 0 | the same wave dir is mounted, so `plant-wave.sh` reuses the signed release |
| the pinned Kiro CLI | the host's native kiro-cli 3.5.0 is mounted read-only, so its SHA-256 is the pin |

What it does not do: it publishes no port, uses no host network, PID or IPC namespace, is not privileged, and sets
`no-new-privileges`. Risk line: the two security options loosen the container's own guard so that bench's sandbox can
start inside it. The agent still runs inside bench's sandbox. Privileged mode is not needed; if `check` still fails at
the sandbox gate, use B rather than adding `--privileged`.

Steps (about 1 to 2 hours, most of it the image build and the login):

```bash
export QH_CHECKOUT=<a konductor worktree of feat/bench-pilot-nk for the run>     # not the ops checkout
export QH_CS=<workspace>/plant-counted-set
export QH_NORMAL=<workspace>/plant-release-r2/tasks
export QH_KIRO=$HOME/.toolbox/tools/kiro-cli/3.5.0/kiro-cli
bash $QH_CHECKOUT/bench/ops/quiet-host/quiet-host.sh print     # free: shows every docker command
bash $QH_CHECKOUT/bench/ops/quiet-host/quiet-host.sh build     # about 5 minutes
bash $QH_CHECKOUT/bench/ops/quiet-host/quiet-host.sh start
bash $QH_CHECKOUT/bench/ops/quiet-host/quiet-host.sh login     # kiro-cli device-code sign-in, once
bash $QH_CHECKOUT/bench/ops/quiet-host/quiet-host.sh check     # free: must print sandbox-ok and end with YES
```

Then the waves, in order (section "The counted run" below). `quiet-host.sh stop` removes the container; the wave dir
and its results stay on the host. Stop Kiro Crew's own heavy jobs first: the load gate reads the host's load.

The free test of the script runs with a stub docker and starts nothing: `bash bench/ops/quiet-host/test-quiet-host.sh`.

## B. A fresh EC2 instance (fallback)

| Step | What |
| --- | --- |
| 1 | Launch Amazon Linux 2023, t3.large, 30 GB root plus a 20 GB second volume, in the owner's own account. No inbound rule; reach it with SSM Session Manager only |
| 2 | Mount the second volume at `/var/tmp/plant-counted-r1` (the out dir must not share a disk with home) |
| 3 | `sudo systemctl stop sshd chronyd` for the run (sshd on `0.0.0.0:22` and chronyd on `127.0.0.1:323` count as listeners) |
| 4 | Install Node 22, Python 3.12 and a venv with `cedarpy==4.12.2`; copy the kiro-cli 3.5.0 binary, the checkout, the counted set, the plant-r2 tasks and the wave dir (`release/`, `release.sha256`, `fields.json`) |
| 5 | `kiro-cli login`, then `unshare -Urm true && echo sandbox-ok` and `plant-host-check` until YES |
| 6 | Run the waves as below with the `PLANT_*` variables pointing at those copies; copy the out dirs back; terminate the instance |

Time about 2 hours; cost about USD 1 for a day.

## The counted run

Inside the quiet host (`quiet-host.sh wave N` runs `plant-wave.sh N` in the container). Soft cap 365 credits for the
whole set; wave 0 spent 40.89.

| Step | Command | Ceiling | Expected |
| --- | --- | --- | --- |
| 1 | `quiet-host.sh check` | free | - |
| 2 | `quiet-host.sh wave 1 --plan`, then `wave 1 --prepare-only` | free | - |
| 3 | `quiet-host.sh wave 1` | 45 | about 26 |
| 4 | `quiet-host.sh wave 2` | 140 | about 81 |
| 5 | `quiet-host.sh wave 3` | 86 | about 50 |
| 6 | `quiet-host.sh wave 4` (reads `held-back.sha256` in the counted set) | 52 | about 30 |

Each wave prints its plant-report command and the files to paste back. Stop and ask when a wave spends more than twice
its expected figure. Before wave 1: the owner's blind sample review (`sheets/sample-10`, D-91).
