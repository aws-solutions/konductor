SHELL := /bin/sh

.PHONY: dev db-reset

dev:
	set -a; . ./.env.local; set +a; node dist/server.js

db-reset:
	node scripts/reset-local-db.js
