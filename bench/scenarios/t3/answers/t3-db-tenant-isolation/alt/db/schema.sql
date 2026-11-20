PRAGMA foreign_keys = ON;

CREATE TABLE tickets (
    ticket_id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    ticket_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    assignee TEXT,
    UNIQUE (tenant_id, ticket_key)
);

CREATE INDEX tickets_tenant_status_created_idx
    ON tickets (tenant_id, status, created_at DESC, ticket_id);

CREATE INDEX tickets_tenant_updated_idx
    ON tickets (tenant_id, updated_at DESC, ticket_id);
