# SPDX-License-Identifier: Apache-2.0
"""The authoritative retired-name -> shipped-name map for the Konductor user guide.

One map, consumed by every part of the guide toolchain:

  * ``apply-renames.py``     rewrites Markdown and the published HTML bundles with it
  * ``check-guide-facts.py`` asserts no retired name survives in either artifact

Every entry is confirmed against the source tree, not inferred:

  agents   agents/*.agent-spec.json (``name``) and
           scripts/brand-config/lib/constants.json (``orchestrator_agent``,
           ``agent_prefix``, ``retired_agent_prefixes``)
  SOPs     ``git log --diff-filter=R --find-renames -- agent-sops/``
  context  context/k-orchestrator-routing-rules.md

When the source renames something again, add it here and nowhere else.
"""

# Order is significant: a longer key must precede any shorter key it contains,
# because substitution runs top to bottom.
RENAMES = [
    # --- context file (must precede asdlc-orchestrator) ----------------------
    ("asdlc-orchestrator-routing-rules", "k-orchestrator-routing-rules"),
    # --- orchestrators -------------------------------------------------------
    # konductor-asdlc-orchestrator is the half-renamed hybrid an earlier pass
    # left behind; the shipped Claude Code agent name is bare `konductor`.
    ("konductor-asdlc-orchestrator", "konductor"),
    ("asdlc-cmux-orchestrator", "konductor-cmux-orchestrator"),
    ("asdlc-mux-orchestrator", "konductor-mux-orchestrator"),
    ("asdlc-orchestrator", "konductor"),
    # --- specialists ---------------------------------------------------------
    ("asdlc-quality-assurance", "k-quality-assurance"),
    ("asdlc-product-manager", "k-product-manager"),
    ("asdlc-media-analyzer", "k-media-analyzer"),
    ("asdlc-architect", "k-architect"),
    ("asdlc-developer", "k-developer"),
    ("asdlc-researcher", "k-researcher"),
    ("asdlc-browser", "k-browser"),
    ("asdlc-tpm", "k-tpm"),
    # --- SOPs ----------------------------------------------------------------
    ("asdlc-codebase-analysis", "k-codebase-analysis"),
    ("asdlc-code-critic", "k-pre-cr-critique"),
    ("asdlc-analyze", "k-context-gathering"),
    ("asdlc-delegate", "k-delegate"),
    ("asdlc-verify", "k-verify"),
    ("asdlc-plan", "k-plan"),
    ("adversarial-pull-request-review", "k-adversarial-pull-request-review"),
    ("comprehensive-test-coverage", "k-test-coverage-review"),
    ("design-review-workflow", "k-existing-design-review"),
    ("code-review-workflow", "k-code-review-workflow"),
    ("design-doc-creation", "k-design-doc-creation"),
    ("code-cleanup", "k-code-cleanup"),
]

# The half-renamed Claude Code forms. An earlier pass believed Claude Code
# prefixed agent names with the package name; it does not -- `dist/claude/agents/*.md`
# frontmatter carries the bare name, so `claude --agent konductor` is the real
# command. These are spelled out rather than derived because the bare-name renames
# above are deliberately boundary-guarded against `-`, which protects the package
# name `ASDLCCoreAICapabilities` itself and so skips these composites.
#
# They must be applied BEFORE the bare renames, hence the prepend below.
_PACKAGE = "ASDLCCoreAICapabilities"
_PREFIXED = [
    (f"{_PACKAGE}-asdlc-cmux-orchestrator", "konductor-cmux-orchestrator"),
    (f"{_PACKAGE}-asdlc-mux-orchestrator", "konductor-mux-orchestrator"),
    (f"{_PACKAGE}-asdlc-orchestrator", "konductor"),
    (f"{_PACKAGE}-asdlc-quality-assurance", "k-quality-assurance"),
    (f"{_PACKAGE}-asdlc-product-manager", "k-product-manager"),
    (f"{_PACKAGE}-asdlc-media-analyzer", "k-media-analyzer"),
    (f"{_PACKAGE}-asdlc-architect", "k-architect"),
    (f"{_PACKAGE}-asdlc-developer", "k-developer"),
    (f"{_PACKAGE}-asdlc-researcher", "k-researcher"),
    (f"{_PACKAGE}-asdlc-browser", "k-browser"),
    (f"{_PACKAGE}-asdlc-tpm", "k-tpm"),
    (f"{_PACKAGE}-konductor", "konductor"),
]
RENAMES = _PREFIXED + RENAMES

# Names that merely LOOK retired. A blanket `asdlc-` -> `k-` sweep corrupts
# these, so every rename pass asserts they survive untouched.
PRESERVE = [
    "asdlc-aspect-review",       # shipped skill, skills/asdlc-aspect-review/
    "asdlc-code-simplifier",     # shipped skill, skills/asdlc-code-simplifier/
    "ASDLCCoreAICapabilities",   # package / repository name
    "ASDLC_BENCH_MODEL_ID",
    "ASDLC_MAX_INLINE_CHARS",
    "ASDLC_CLAUDE_AGENTS_DIR",
]


# Download hosts an earlier draft of the guide invented. Neither was ever real:
# there is no hosted binary, and `--from <repo-root>` is still the only way to
# install. Both are gone from the Markdown and from both bundles; this list keeps
# them gone, so the guide can never again tell a reader to curl a domain nobody
# owns. Checked by ``check-guide-facts.py``.
RETIRED_DOMAINS = [
    "konductor.sh",
    "konductor.ai",
]


def retired_names():
    """Every retired token, for a 'did any survive?' assertion."""
    return sorted({old for old, _ in RENAMES})
