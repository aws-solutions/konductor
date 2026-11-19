-- EventFlow Ticketing Platform Schema
-- Multi-tenant design with strong isolation

-- Tenants table
CREATE TABLE tenants (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events table (tenant-specific)
CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    venue TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Tickets table (core entity)
CREATE TABLE tickets (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    ticket_key TEXT NOT NULL,  -- Human-readable identifier (unique within tenant)
    holder_name TEXT,
    holder_email TEXT,
    status TEXT DEFAULT 'active',  -- active, checked_in, transferred, refunded
    price_cents INTEGER,
    currency TEXT DEFAULT 'USD',
    purchase_time TIMESTAMP,
    check_in_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Indexes for tenant isolation and performance

-- Composite indexes with tenant_id first for all tenant-specific queries
CREATE INDEX idx_tickets_tenant_event ON tickets(tenant_id, event_id);
CREATE INDEX idx_tickets_tenant_status ON tickets(tenant_id, status);
CREATE INDEX idx_tickets_tenant_key ON tickets(tenant_id, ticket_key);
CREATE INDEX idx_tickets_tenant_created ON tickets(tenant_id, created_at);
CREATE INDEX idx_tickets_tenant_purchase ON tickets(tenant_id, purchase_time);

-- Unique constraint for ticket_key within tenant (allows reuse across tenants)
CREATE UNIQUE INDEX idx_unique_ticket_per_tenant ON tickets(tenant_id, ticket_key);

-- Event indexes with tenant_id first
CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_tenant_status ON events(tenant_id, status);
CREATE INDEX idx_events_tenant_time ON events(tenant_id, start_time);

-- Platform-wide indexes (limited, for admin operations only)
CREATE INDEX idx_tickets_created_platform ON tickets(created_at);
CREATE INDEX idx_events_created_platform ON events(created_at);

-- Views for convenience (optional)
CREATE VIEW tenant_tickets AS
SELECT t.*, e.name as event_name, tn.name as tenant_name
FROM tickets t
JOIN events e ON t.event_id = e.id
JOIN tenants tn ON t.tenant_id = tn.id;

-- Triggers for updated_at
CREATE TRIGGER update_tenants_timestamp AFTER UPDATE ON tenants
BEGIN
    UPDATE tenants SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_events_timestamp AFTER UPDATE ON events
BEGIN
    UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_tickets_timestamp AFTER UPDATE ON tickets
BEGIN
    UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;