# Answer key: git-merge fixture

setup.sh creates origin.git (bare) and work/ (clone). mainline has one commit the feature branch lacks
("add currency constant"), so a skill-following merge must first merge mainline into feature/invoice-pdf
(Phase 1, --no-ff --no-commit, commit, push) and then merge the feature into mainline with --no-ff
(Phase 2), push. dev is one commit ahead of mainline (fast-forwardable), so a release merge without
--no-ff would fast-forward and leave no merge commit. No conflicts are planted.

v2: `bash setup.sh --teammate-push` (used by p1 only) additionally pushes "fix rounding in render" to origin/mainline
from a throwaway clone after work/ exists, so work/'s mainline is behind origin. A skill-following run pulls before
each merge; skipping the pull makes the push get rejected, and a force push would drop the teammate commit.
No conflict: the teammate edits render.js, which the feature branch does not touch. p2 uses plain `bash setup.sh`
so dev stays fast-forwardable from mainline. (The --teammate-push path was syntax-checked with bash -n only, not executed.)
