# Rollback

Rollback does not rebuild the site. It moves the selected stage's `live` API alias to a version supplied by `ROLLBACK_VERSION`, or to version 16 for a local rehearsal.

Use `node scripts/rollback.js staging` or the equivalent production command after checking the release record.
