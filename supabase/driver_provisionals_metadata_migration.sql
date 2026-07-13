-- Add jsonb metadata for auto-synced provisional ledger rows.
-- Run manually in Supabase SQL editor after reviewing.

alter table driver_provisionals
  add column if not exists metadata jsonb;
