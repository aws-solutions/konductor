# SPDX-License-Identifier: Apache-2.0
# The spend and host helpers the paid run scripts of this folder share (DEBT D-242; bench/kit/2x2/lib.sh did the same
# for D-46). Sourced, never run: `. "$(dirname "$0")/lib.sh"`. POSIX sh, as some scripts here run under sh.
# Each script keeps its own caps, plan, resume loop and messages; these helpers read only their arguments and
# LOAD_MAX (default 4), HEAVY_LOCK (default /var/tmp/konductor-heavy.lock), CAP and R.

# budget_for SPENT LIMIT BUDGET [CAP] [FORMAT]: the batch budget, the larger of LIMIT (one run) and BUDGET, cut so that
# SPENT + 0.9 x budget + LIMIT stays under CAP (default $CAP); prints STOP when not even one run fits. FORMAT: %d or %.2f.
budget_for() {
  awk -v s="$1" -v l="$2" -v b="$3" -v c="${4:-$CAP}" -v f="${5:-%d}" 'BEGIN { if (b < l) b = l; m = (c - s - l) / 0.9;
    if (m < b) b = m; if (b < l) print "STOP"; else printf f, b }'
}

# worst_case SPENT BUDGET LIMIT [RUNS]: the most the batch can bring the spend to: SPENT + 0.9 x BUDGET + LIMIT, or, with
# RUNS, never more than RUNS x LIMIT on top of SPENT (each run is capped at LIMIT on its own).
worst_case() {
  awk -v s="$1" -v b="$2" -v l="$3" -v n="${4:-}" 'BEGIN { w = 0.9 * b + l; if (n != "" && n * l < w) w = n * l; printf "%.2f", s + w }'
}

# wait_host [PATTERN]: wait up to 60 min for load under LOAD_MAX and a free heavy lock (and, with PATTERN, no process
# matching it); stop after that. Polls once a minute.
wait_host() {
  _wh_i=0
  while :; do
    _wh_l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$_wh_l" -v m="${LOAD_MAX:-4}" 'BEGIN { exit !(l < m) }' && flock -n "${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}" true \
      && { [ -z "${1:-}" ] || ! pgrep -f "$1" >/dev/null; }; then return 0; fi
    _wh_i=$((_wh_i + 1))
    if [ "$_wh_i" -gt 60 ]; then
      if [ -n "${1:-}" ]; then stop "load $_wh_l, heavy lock or another bench run busy for 60 min"; else stop "load $_wh_l or heavy lock busy for 60 min"; fi
    fi
    sleep 60
  done
}

# ledger_spent DIR [SUB ...]: credits charged under DIR, the sum of bench's credit ledger (runner/lib/credit-ledger.js
# readLedger, at the frozen bench R) of each SUB dir, or of every child of DIR but the .done markers.
ledger_spent() {
  _ls_dir=$1; shift
  node -e 'const { readLedger } = require(process.argv[1]); const fs = require("fs"), p = require("path");
    const [d, ...subs] = process.argv.slice(2);
    const names = subs.length ? subs : (fs.existsSync(d) ? fs.readdirSync(d).filter((t) => !t.endsWith(".done")) : []);
    let s = 0; for (const t of names) if (fs.existsSync(p.join(d, t))) s += readLedger(p.join(d, t)).totals.total;
    console.log(s.toFixed(2))' "$R/bench/runner/lib/credit-ledger.js" "$_ls_dir" "$@"
}
