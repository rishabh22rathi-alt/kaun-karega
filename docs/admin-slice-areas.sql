-- Area Mappings migration
-- Run this in the Supabase SQL editor before deploying the Area/Alias admin migration.
-- After running, seed from the GAS "Areas" and "AreaAliases" sheets.

CREATE TABLE IF NOT EXISTS areas (
  id         BIGSERIAL   PRIMARY KEY,
  area_name  TEXT        NOT NULL UNIQUE,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS area_aliases (
  id             BIGSERIAL   PRIMARY KEY,
  alias_name     TEXT        NOT NULL UNIQUE,
  canonical_area TEXT        NOT NULL,
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS area_aliases_canonical_area_idx ON area_aliases (canonical_area);
CREATE INDEX IF NOT EXISTS area_aliases_active_idx ON area_aliases (active);
CREATE INDEX IF NOT EXISTS areas_active_idx ON areas (active);

-- Seeding format for areas:
-- INSERT INTO areas (area_name, active) VALUES ('Boranada', true) ON CONFLICT (area_name) DO NOTHING;

-- Seeding format for area_aliases:
-- INSERT INTO area_aliases (alias_name, canonical_area, active)
--   VALUES ('Boranada Jodhpur', 'Boranada', true)
--   ON CONFLICT (alias_name) DO NOTHING;
