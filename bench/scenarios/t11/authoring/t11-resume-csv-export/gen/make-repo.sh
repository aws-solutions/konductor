#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE="$ROOT/fixture"
rm -rf "$FIXTURE"
node "$ROOT/gen/create-project.js"
cd "$FIXTURE"
git init -q -b main

author_name='Mara Quill'
author_email='mara.quill@example.invalid'
commit() {
  date_value=$1
  shift
  GIT_AUTHOR_NAME="$author_name" GIT_AUTHOR_EMAIL="$author_email" \
  GIT_AUTHOR_DATE="$date_value" GIT_COMMITTER_NAME="$author_name" \
  GIT_COMMITTER_EMAIL="$author_email" GIT_COMMITTER_DATE="$date_value" \
  git commit -q -m "$1"
}

# Main begins with the small library and its file-backed command.
git add package.json .gitignore .editorconfig LICENSE index.js src/export.js src/store.js bin/timesheet.js
git add -f bin/timesheet.js
commit '2025-02-01T09:00:00+0000' 'Start the minute ledger library'

git add src/clock.js src/summary.js
commit '2025-02-02T09:00:00+0000' 'Add time calculations and project summaries'

git add README.md docs/data-format.md docs/maintenance.md docs/decisions.md
commit '2025-02-03T09:00:00+0000' 'Describe the JSON ledger shape'

git add data config src/settings.js src/labels.js src/format.js
commit '2025-02-04T09:00:00+0000' 'Add sample ledgers and local settings'

git add docs/commands.md docs/faq.md docs/release.md docs/weekly-routine.md
commit '2025-02-05T09:00:00+0000' 'Add command reference pages'

git add test/package.json test/index.js test/export-json.test.js test/store.test.js test/clock.test.js test/summary.test.js test/cli.test.js test/labels.test.js
commit '2025-02-06T09:00:00+0000' 'Cover the file store and basic commands'

git add .github LICENSE SECURITY.md CONTRIBUTING.md NOTICE.txt
commit '2025-02-07T09:00:00+0000' 'Add project maintenance files'

git add scripts docs/old-import.md data/README.md notes
commit '2025-02-08T09:00:00+0000' 'Keep small maintenance scripts nearby'

git add CHANGELOG.md
commit '2025-02-09T09:00:00+0000' 'Record the first stable release notes'

# The handoff branch contains five ordinary work-in-progress commits.
git checkout -q -b feature/csv-export
node "$ROOT/gen/apply-wip.js" source
git add src/export.js
commit '2025-02-11T09:00:00+0000' 'Route exports through a CSV formatter'

node "$ROOT/gen/apply-wip.js" cli
git add bin/timesheet.js
commit '2025-02-12T09:00:00+0000' 'Accept a lower-case export format flag'

node "$ROOT/gen/apply-wip.js" notes
git add NOTES-csv-export.md
commit '2025-02-13T09:00:00+0000' 'Write down the CSV handoff checklist'

node "$ROOT/gen/apply-wip.js" decision
git add docs/csv-export.md
commit '2025-02-14T09:00:00+0000' 'Review CSV timestamps: use UTC ISO 8601'

node "$ROOT/gen/apply-wip.js" final
git add CHANGELOG.md
commit '2025-02-15T09:00:00+0000' 'Note the unfinished tabular export'

if [ -n "$(git status --porcelain)" ]; then
  echo 'fixture is not clean' >&2
  exit 1
fi
git gc -q
rm -rf .git/hooks
mv .git dotgit
printf 'fixture ready: %s files, branch feature/csv-export\n' "$(find . -type f ! -path './dotgit/*' | wc -l | tr -d ' ')"
