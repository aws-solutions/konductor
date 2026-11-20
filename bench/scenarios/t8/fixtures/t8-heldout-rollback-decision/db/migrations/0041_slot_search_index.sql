-- release 4.17.0
CREATE INDEX CONCURRENTLY IF NOT EXISTS slots_zone_day_idx ON delivery_slots (zone_id, day);
