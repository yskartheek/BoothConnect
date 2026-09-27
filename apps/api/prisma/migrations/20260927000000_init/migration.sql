-- Baseline migration: no tables yet, only database-wide conventions.

-- Sessions default to UTC, so timestamptz values are shown and compared in UTC
-- even from psql or other tools. (Prisma always sends UTC anyway.)
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
