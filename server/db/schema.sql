-- Run this once against your Railway (or any Postgres) database to set up
-- the schema.  From the server directory:
--   psql $DATABASE_URL -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMP   DEFAULT NOW()
);

-- ─── Profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID      REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT,
  school           TEXT,
  year             TEXT,
  major            TEXT,
  hometown         TEXT,
  goal             TEXT,
  target_role      TEXT,
  timeline         TEXT,
  background_blurb TEXT,
  work_experience  JSONB,
  activities       TEXT,
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- One profile per user
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_idx ON profiles(user_id);

-- Gmail OAuth tokens (run separately if table already exists)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gmail_tokens JSONB;

-- Resume attachment toggle and stored PDF
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS attach_resume BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_pdf BYTEA;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_filename TEXT;

-- Recruiting context (replaces target_role UX; target_role preserved for existing users)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recruiting_stage TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_areas TEXT;

-- ─── Outreach tracker ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID      REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT      NOT NULL,
  firm            TEXT,
  role            TEXT,
  date_added      DATE      DEFAULT CURRENT_DATE,
  source          TEXT      DEFAULT 'manual',
  stage           TEXT      DEFAULT 'Drafted',
  reply_status    TEXT      DEFAULT 'Awaiting Reply',
  follow_up_date  DATE,
  notes           TEXT,
  gmail_thread_id TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);
