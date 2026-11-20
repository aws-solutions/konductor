-- Audit Log Database Schema
-- Designed for 25,000 events/second, 400-day retention
-- Uses monthly partitioning for efficient retention cleanup

-- Main audit log table with monthly partitioning
CREATE TABLE audit_logs (
    -- Primary key with timestamp component for partition routing
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    event_time TIMESTAMPTZ NOT NULL,
    
    -- Event metadata
    event_id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    
    -- User context
    user_id VARCHAR(255) NOT NULL,
    user_session_id VARCHAR(255),
    source_ip INET,
    user_agent TEXT,
    
    -- Resource context
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    resource_path TEXT,
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    action_result VARCHAR(50) NOT NULL CHECK (action_result IN ('SUCCESS', 'FAILURE', 'DENIED')),
    action_duration_ms INTEGER,
    
    -- Additional context
    correlation_id UUID,
    tenant_id VARCHAR(100),
    region VARCHAR(50),
    
    -- Raw event data (compressed JSON)
    event_data JSONB NOT NULL DEFAULT '{}',
    
    -- System metadata
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Primary key includes partition key for efficient partitioning
    PRIMARY KEY (event_time, id)
) PARTITION BY RANGE (event_time);

-- Create monthly partitions for the next 14 months (400 days ~ 13.3 months)
-- We create with 1 month overlap for safety
CREATE TABLE audit_logs_2024_11 PARTITION OF audit_logs
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE audit_logs_2024_12 PARTITION OF audit_logs
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE audit_logs_2025_01 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE audit_logs_2025_02 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE audit_logs_2025_03 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE audit_logs_2025_04 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE audit_logs_2025_05 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE audit_logs_2025_06 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE audit_logs_2025_07 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE audit_logs_2025_08 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE audit_logs_2025_09 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE audit_logs_2025_10 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE audit_logs_2025_11 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE audit_logs_2025_12 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Indexes (limited to 1 secondary index to stay within storage limit)

-- Primary index is on (event_time, id) for partition routing

-- Single secondary index covering both user and time queries
-- This supports: user activity analysis AND time-range queries
CREATE INDEX idx_audit_logs_user_time ON audit_logs (user_id, event_time DESC)
    INCLUDE (action, resource_type, action_result);

-- The above index supports:
-- 1. User activity queries: WHERE user_id = ? ORDER BY event_time DESC
-- 2. Time-range queries with user filter: WHERE user_id = ? AND event_time BETWEEN ? AND ?
-- 3. Covers common columns to avoid table lookups

-- Note: We cannot add additional indexes like (resource_type, event_time) or 
-- (severity, event_time) due to storage constraints (would exceed 300 TB limit).

-- Function to automatically create new monthly partitions
CREATE OR REPLACE FUNCTION create_audit_log_partition(month_date DATE)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    partition_name := 'audit_logs_' || to_char(month_date, 'YYYY_MM');
    start_date := date_trunc('month', month_date);
    end_date := start_date + INTERVAL '1 month';
    
    EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;

-- Function for retention cleanup (drops old partitions)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 400)
RETURNS INTEGER AS $$
DECLARE
    cutoff_date DATE;
    partitions_dropped INTEGER := 0;
    partition_record RECORD;
BEGIN
    cutoff_date := CURRENT_DATE - retention_days;
    
    FOR partition_record IN
        SELECT inhrelid::regclass AS partition_name,
               pg_get_expr(relpartbound, inhrelid) AS partition_bound
        FROM pg_inherits
        JOIN pg_class ON inhrelid = pg_class.oid
        WHERE inhparent = 'audit_logs'::regclass
    LOOP
        -- Extract upper bound from partition definition
        IF partition_record.partition_bound LIKE '%TO (%' THEN
            -- Parse the upper bound date
            DECLARE
                upper_bound_text TEXT;
                upper_bound_date DATE;
            BEGIN
                upper_bound_text := substring(
                    partition_record.partition_bound 
                    FROM 'TO \(''([^'']+)''\)'
                );
                upper_bound_date := upper_bound_text::DATE;
                
                -- If the entire partition is older than retention period, drop it
                IF upper_bound_date < cutoff_date THEN
                    EXECUTE format('DROP TABLE %I', partition_record.partition_name);
                    partitions_dropped := partitions_dropped + 1;
                    RAISE NOTICE 'Dropped partition % (upper bound: %)', 
                        partition_record.partition_name, upper_bound_date;
                END IF;
            END;
        END IF;
    END LOOP;
    
    RETURN partitions_dropped;
END;
$$ LANGUAGE plpgsql;

-- View for common queries
CREATE VIEW audit_logs_summary AS
SELECT 
    DATE(event_time) as event_date,
    user_id,
    resource_type,
    action,
    action_result,
    COUNT(*) as event_count,
    AVG(action_duration_ms) as avg_duration_ms
FROM audit_logs
WHERE event_time >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(event_time), user_id, resource_type, action, action_result;

-- Comment explaining the indexing strategy
COMMENT ON TABLE audit_logs IS 'Audit logs with monthly partitioning. Single secondary index (user_id, event_time) to stay within 300 TB storage limit while supporting common queries.';
COMMENT ON INDEX idx_audit_logs_user_time IS 'Single secondary index covering user activity and time-range queries. Additional indexes would exceed storage capacity.';