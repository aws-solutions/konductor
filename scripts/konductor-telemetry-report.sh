#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# konductor-telemetry-report.sh — transport only.
#
# Takes an already-resolved endpoint as its one positional argument and
# reads the JSON body from stdin. Does no config reading, no YAML/JSON
# parsing of its own, and no endpoint resolution -- all of that happens
# in Rust before this script is ever invoked. Embedded into the
# konductor/skill-lookup-mcp binaries at compile time via include_str!
# and materialized to a temp path at runtime -- this file is never
# executed directly from the source tree.
#
# Usage: konductor-telemetry-report.sh <https-endpoint> [resolve-triple]
#   stdin: the JSON request body
#   resolve-triple (optional): a curl `--resolve host:port:address`
#     value -- the exact address the Rust-side caller already resolved
#     and validated for this endpoint's host, pinning curl to it instead
#     of letting curl perform its own, independent, later resolution
#     (see the PINNING note below). Omitted (or empty) when the caller
#     had nothing to pin (an IP literal, an unresolvable host, or the
#     debug escape hatch).
#
# Enforces:
#   - the endpoint must start with https:// (rejected before curl runs,
#     before stdin is even read)
#   - the endpoint's host -- and, best-effort, every address it
#     resolves to (see the resolution block below) -- must not be
#     loopback/link-local/RFC-1918 private-range, UNLESS
#     KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT is set
#   - curl --max-time 3 (fail-open, non-blocking network boundary)
#   - never exits non-zero on network failure -- this script's own exit
#     code is never inspected by the caller (the caller detaches
#     and never .wait()s), but it still doesn't propagate curl's own
#     exit status upward on purpose, consistent with the "telemetry
#     failure never propagates" guarantee.
#
# AUTHORITATIVE vs. DEFENSE-IN-DEPTH: the checks below are a SECOND,
# independent enforcement point for the SAME allowlist
# `resolve_endpoint`'s Rust callers already apply
# (`endpoint_host_is_allowed` in both `cli/telemetry/report.rs` and
# `mcp/lib/skill-lookup-core/src/telemetry.rs`) before this script is
# ever invoked with the endpoint they resolved -- in the REAL call path,
# the Rust-side check (including its own DNS resolution step) has
# already run and already gates whether this script gets invoked with
# that endpoint at all. This script cannot skip DNS resolution the way
# the Rust side conceivably could: `curl "$endpoint"` performs its own
# resolution regardless of what this script checks, so an endpoint that
# reaches this point with a hostname resolving to a local/private
# address will be connected to by curl unless this script also
# resolves it. The resolution block below is BEST-EFFORT, not
# authoritative -- `getent`/`dig`/`host` are not guaranteed to exist on
# every platform this POSIX-`sh` script targets, and a portable DNS
# client is well outside a dependency-free transport script's scope
# (see the module header above). When none of those tools are present,
# this script silently skips resolution and relies on the Rust-side
# check having already run first, which it always does on the real
# call path (`send_event` -> `resolve_endpoint` -> `spawn_and_send` ->
# this script) -- a hypothetical direct invocation with an
# already-validated endpoint that skipped that path is the only
# scenario this defense-in-depth layer, present or absent, actually
# protects.
#
# PINNING (adversarial finding: DNS-rebinding TOCTOU): even with the
# best-effort resolution block above, a hostname that resolves to a SAFE
# address at the moment THIS SCRIPT checks it can resolve to a DIFFERENT
# (unsafe) address by the moment `curl` itself connects -- two
# independent resolutions, arbitrarily far apart in wall-clock terms, is
# exactly the window a DNS-rebinding attacker needs. The `resolve-triple`
# argument closes this for the REAL call path: it pins `curl` to the
# SAME address the Rust-side caller already validated, so curl performs
# NO resolution of its own for that request. When absent, curl falls
# back to its own resolution, unpinned -- exactly this script's
# pre-existing behavior before this argument existed.

set -u

endpoint="${1:-}"
resolve_arg="${2:-}"

case "$endpoint" in
  https://*) ;;
  *)
    exit 0
    ;;
esac

# Classifies one IP literal (never a hostname) as
# loopback/link-local/RFC-1918-private. Includes the IPv4-mapped-IPv6
# form (`::ffff:a.b.c.d`, RFC 4291 Sec 2.5.5.2) as its own pattern set --
# `::ffff:127.0.0.1` does not textually match `::1`/`fe8?:*`/`fe9?:*`/
# `fea?:*`/`feb?:*` any more than it numerically resolves to them, so it
# needs its own case arms rather than being caught by the plain-IPv6
# patterns below. Returns 0 (shell true) if disallowed, 1 otherwise.
#
# The IPv6 link-local range is `fe80::/10` (AutoSDE finding
# `f-0c663cdd`): its first hextet ranges over `fe80`-`febf`, not just
# the literal `fe80` prefix a bare `fe80:*` glob matches -- an address
# like `fe9a::1` is link-local yet a `fe80:*`-only glob would miss it,
# while the Rust-side check (`is_disallowed_ip` in the `konductor-telemetry`
# crate) already covers the full range via a bitmask
# (`(v6.segments()[0] & 0xffc0) == 0xfe80`). A POSIX-`sh` glob cannot
# express a bitmask directly, but the four hextets `fe8?`/`fe9?`/`fea?`/
# `feb?` are exactly `fe80`-`febf` in hex and cover the same range this
# defense-in-depth layer must match.
#
# The IPv6 unique-local range is `fc00::/7` (AutoSDE finding
# `f-83540965`) -- the IPv6 analog of the IPv4 RFC 1918 private ranges
# already matched above (`10.*`/`172.16-31.*`/`192.168.*`), mirroring
# the Rust-side bitmask (`(v6.segments()[0] & 0xfe00) == 0xfc00`).
# Unlike `fe80::/10` above, this /7 prefix's free bit lands exactly on a
# nibble boundary: the first hex digit is fixed to `f` and the second
# is fixed to exactly `c` or `d` (never any other value), with the
# third and fourth hex digits entirely free -- so `fc??`/`fd??` is an
# EXACT match for the full range, not an approximation the way the
# four-hextet enumeration above is for `fe80::/10`.
#
# The unspecified address `0.0.0.0`/`::` (AutoSDE finding `f-02064b4b`)
# is matched as its own literal, mirroring the Rust-side
# `is_unspecified()` checks -- neither the loopback/link-local/private
# patterns above nor the plain `::1` pattern catch it, and on Linux a
# connection to `0.0.0.0` routes to a local service on loopback. Its
# IPv4-mapped form, `::ffff:0.0.0.0` (AutoSDE finding `f-ac7282ef`), is
# matched alongside the other `::ffff:*.*.*.*` dotted-decimal arms below
# so both forms stay in parity with the Rust side, which unmaps via
# `to_ipv4_mapped()` and rejects via `is_unspecified()`; its hex form
# (`::ffff:0:0`) is covered for free by the `::ffff:*:*` recursion
# further down, since it normalizes to this same dotted-decimal literal.
#
# 100.64.0.0/10 (RFC 6598 Shared Address Space / CGNAT) is matched by
# splitting the /10 across four glob arms on the second octet
# (`6[4-9]` = 64-69, `[7-9][0-9]` = 70-99, `1[01][0-9]` = 100-119,
# `12[0-7]` = 120-127 -- together exactly 64-127), mirroring the
# Rust-side `is_shared_address_space_cgnat` bitmask check. The same four
# arms are mirrored under the `::ffff:` prefix so an IPv4-mapped CGNAT
# literal (`::ffff:100.64.0.1`) is rejected in dotted-decimal form the
# same way the hex form (`::ffff:6440:1`) already is via its recursion
# into this dotted-decimal set.
is_disallowed_ip() {
  case "$1" in
    127.*.*.* | 169.254.*.* | 10.*.*.* | 192.168.*.* | 0.0.0.0) return 0 ;;
    172.1[6-9].*.* | 172.2[0-9].*.* | 172.3[01].*.*) return 0 ;;
    100.6[4-9].*.* | 100.[7-9][0-9].*.* | 100.1[01][0-9].*.* | 100.12[0-7].*.*) return 0 ;;
    :: | ::1 | fe8?:* | fe9?:* | fea?:* | feb?:* | fc??:* | fd??:*) return 0 ;;
    ::ffff:127.*.*.* | ::ffff:169.254.*.* | ::ffff:10.*.*.* | ::ffff:192.168.*.* | ::ffff:0.0.0.0) return 0 ;;
    ::ffff:172.1[6-9].*.* | ::ffff:172.2[0-9].*.* | ::ffff:172.3[01].*.*) return 0 ;;
    ::ffff:100.6[4-9].*.* | ::ffff:100.[7-9][0-9].*.* | ::ffff:100.1[01][0-9].*.* | ::ffff:100.12[0-7].*.*) return 0 ;;
    2002:*)
      # 6to4 (RFC 3056): 2002::/16 embeds an IPv4 address in the next
      # 32 bits (the first two hextets after the prefix), mirroring the
      # Rust-side `six_to_four_embedded_ipv4`. Extracted the same way
      # the `::ffff:HHHH:HHHH` hex-form case below extracts its
      # embedded address, then recursed into the plain (non-mapped)
      # IPv4 arms above -- e.g. "2002:6440:0001::" embeds "100.64.0.1"
      # (CGNAT), which the recursive call classifies via the arm just
      # above.
      rest="${1#2002:}"
      hi="${rest%%:*}"
      lo="${rest#*:}"
      lo="${lo%%:*}"
      case "$hi" in '' | *[!0-9a-fA-F]*) hi="" ;; esac
      case "$lo" in '' | *[!0-9a-fA-F]*) lo="" ;; esac
      if [ -n "$hi" ] && [ -n "$lo" ] && [ ${#hi} -le 4 ] && [ ${#lo} -le 4 ]; then
        hi_dec=$((0x$hi))
        lo_dec=$((0x$lo))
        dotted="$((hi_dec / 256)).$((hi_dec % 256)).$((lo_dec / 256)).$((lo_dec % 256))"
        if is_disallowed_ip "$dotted"; then
          return 0
        fi
        return 1
      fi
      # hi or lo came up empty here (e.g. "2002::1" leaves hi empty,
      # "2002:6440::" leaves lo empty) -- "::" zero-compression landed
      # on the embedded-IPv4 portion itself (AutoSDE finding
      # `f-7db7e337`), which this naive colon-split extraction can't
      # safely resolve to a specific address without full IPv6 "::"
      # expansion (the compressed run can place its remaining explicit
      # hextet at a LATER segment entirely, not necessarily this one).
      # Fail closed (deny) instead of the address-computation this arm
      # can't reliably do: this is a best-effort, non-authoritative
      # defense-in-depth layer (the Rust side is authoritative and
      # parses "::" correctly), so denying what this layer can't
      # cleanly classify is the safe direction, matching this crate's
      # existing "deny outright when uncertain" bias.
      return 0
      ;;
    64:ff9b::*.*.*.*)
      # NAT64 Well-Known Prefix (RFC 6052), dotted-decimal form:
      # "64:ff9b::a.b.c.d" embeds the IPv4 address directly after the
      # "::", mirroring the Rust-side
      # `nat64_well_known_prefix_embedded_ipv4`.
      embedded="${1#64:ff9b::}"
      if is_disallowed_ip "$embedded"; then
        return 0
      fi
      return 1
      ;;
    64:ff9b::*)
      # NAT64 WKP, hex-hextet form: "64:ff9b::HHHH:HHHH" embeds the
      # IPv4 address in the low 32 bits. Same extract-then-recurse
      # technique as the 6to4 arm above.
      rest="${1#64:ff9b::}"
      # A `rest` with no colon at all (e.g. "64:ff9b::6440") is a
      # valid, fully-compressed address (64:ff9b:0000:...:0000:6440)
      # whose single remaining hextet occupies the LOW position only
      # -- the split below would instead duplicate it into both hi
      # AND lo, computing a wrong embedded address. Fail closed (deny)
      # rather than risk that, same rationale as the empty-hi/lo case
      # below.
      case "$rest" in
        *:*) ;;
        *) return 0 ;;
      esac
      hi="${rest%%:*}"
      lo="${rest#*:}"
      lo="${lo%%:*}"
      case "$hi" in '' | *[!0-9a-fA-F]*) hi="" ;; esac
      case "$lo" in '' | *[!0-9a-fA-F]*) lo="" ;; esac
      if [ -n "$hi" ] && [ -n "$lo" ] && [ ${#hi} -le 4 ] && [ ${#lo} -le 4 ]; then
        hi_dec=$((0x$hi))
        lo_dec=$((0x$lo))
        dotted="$((hi_dec / 256)).$((hi_dec % 256)).$((lo_dec / 256)).$((lo_dec % 256))"
        if is_disallowed_ip "$dotted"; then
          return 0
        fi
        return 1
      fi
      # hi or lo came up empty -- "::" zero-compression landed on the
      # embedded-IPv4 portion itself. Same fail-closed rationale as
      # the 6to4 arm above: this naive colon-split can't safely
      # resolve the true embedded address here.
      return 0
      ;;
    ::ffff:*:*)
      # Hex form of an IPv4-mapped IPv6 address (AutoSDE finding
      # `f-3aa4ac3e`), e.g. `::ffff:7f00:1` (= 127.0.0.1) -- distinct
      # from the dotted-decimal form matched above. The Rust-side
      # `is_disallowed_ip` already handles both forms via
      # `to_ipv4_mapped()`; this defense-in-depth layer is
      # best-effort and non-authoritative (see the module header), but
      # is fixed anyway for parity. A blanket `::ffff:*:*` arm would be
      # WRONG here -- it would over-block a genuinely public address in
      # mapped form (e.g. `::ffff:808:808` = 8.8.8.8) -- and per-range
      # hex globs are fragile since hextets drop leading zeros
      # (`::ffff:a00:1` for `10.0.0.0`). So instead: normalize the two
      # hex hextets back to dotted-decimal and recurse into this same
      # function, reusing the dotted-decimal arms above rather than
      # enumerating hex ranges.
      hex_part="${1#::ffff:}"
      hi="${hex_part%%:*}"
      lo="${hex_part#*:}"
      # Reject anything that isn't 1-4 hex digits (also rejects `lo`
      # when `hex_part` had more than one remaining colon, i.e. this
      # wasn't really the two-hextet mapped form after all) -- falls
      # through unmatched rather than misclassifying an unrelated
      # address shape.
      case "$hi" in
        '' | *[!0-9a-fA-F]*) hi="" ;;
      esac
      case "$lo" in
        '' | *[!0-9a-fA-F]*) lo="" ;;
      esac
      if [ -n "$hi" ] && [ -n "$lo" ] && [ ${#hi} -le 4 ] && [ ${#lo} -le 4 ]; then
        hi_dec=$((0x$hi))
        lo_dec=$((0x$lo))
        dotted="$((hi_dec / 256)).$((hi_dec % 256)).$((lo_dec / 256)).$((lo_dec % 256))"
        if is_disallowed_ip "::ffff:$dotted"; then
          return 0
        fi
      fi
      return 1
      ;;
    *) return 1 ;;
  esac
}

if [ -z "${KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT:-}" ]; then
  # Extract the host: strip the scheme, then everything from the first
  # "/" (path), "?" (query), or "#" (fragment) onward.
  host="${endpoint#https://}"
  host="${host%%/*}"
  host="${host%%\?*}"
  host="${host%%\#*}"
  # Strip URL userinfo (`user[:pass]@`) BEFORE parsing host/port
  # (AutoSDE finding `f-2133c92b`, mirroring the Rust-side
  # `extract_host`'s identical fix): curl discards everything up to
  # and including the LAST "@" when connecting, so
  # "https://x@127.0.0.1/collector" must classify by the host AFTER
  # the "@", never the literal "x@127.0.0.1" string (which matches
  # neither "localhost" nor any IP pattern below, and would otherwise
  # sail through as an allowed ordinary hostname while curl itself
  # connects straight to 127.0.0.1). `${host##*@}` removes the
  # LONGEST matching "*@" prefix -- i.e. up to the LAST "@" -- matching
  # curl's own parsing for a userinfo value that itself contains "@".
  host="${host##*@}"
  case "$host" in
    \[*)
      # Bracketed IPv6, e.g. [::1] or [::1]:443 -- host is up to the
      # closing bracket.
      host="${host#\[}"
      host="${host%%]*}"
      ;;
    *)
      # Ordinary hostname/IPv4 literal, optionally followed by
      # ":<port>" -- strip it the same way the Rust-side
      # `extract_host` does.
      host="${host%%:*}"
      ;;
  esac

  case "$host" in
    localhost | LOCALHOST | LocalHost)
      exit 0
      ;;
  esac
  if is_disallowed_ip "$host"; then
    exit 0
  fi

  # Best-effort DNS resolution (see the AUTHORITATIVE vs.
  # DEFENSE-IN-DEPTH note above): if `$host` is itself an IP literal,
  # each tool below just echoes it back (no real query); if it's a
  # hostname, this actually resolves it and checks what it resolves to
  # -- closing the same "hostname resolves to a local address at
  # request time" gap the Rust-side fix closes, for whatever fraction
  # of invocations reach this script without having already gone
  # through that check. Tried in order; the first available tool wins,
  # and if none are available, resolution is skipped entirely (falls
  # through to curl, relying on the Rust-side check per the note
  # above) rather than failing this script closed over a missing
  # optional dependency.
  resolved=""
  if command -v getent >/dev/null 2>&1; then
    resolved=$(getent hosts "$host" 2>/dev/null | awk '{print $1}')
  elif command -v dig >/dev/null 2>&1; then
    resolved=$(dig +short "$host" 2>/dev/null | grep -E '^[0-9a-fA-F.:]+$')
  elif command -v host >/dev/null 2>&1; then
    resolved=$(host "$host" 2>/dev/null | awk '/has address|has IPv6 address/ {print $NF}')
  fi
  for addr in $resolved; do
    if is_disallowed_ip "$addr"; then
      exit 0
    fi
  done
fi

# Built as a positional-parameter list (`set --`), not a single string,
# so `--resolve "$resolve_arg"` is either present-with-its-own-argument
# or absent entirely -- no shell word-splitting/quoting hazard from
# conditionally embedding it inline, and no need to write two
# near-duplicate `curl` invocations for the pinned/unpinned cases.
set -- --max-time 3 --silent --show-error
if [ -n "$resolve_arg" ]; then
  set -- "$@" --resolve "$resolve_arg"
fi
set -- "$@" \
  --request POST \
  --header "Content-Type: application/json" \
  --data-binary @- \
  "$endpoint"

curl "$@" >/dev/null 2>&1

exit 0
