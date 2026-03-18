-- Migration: Full schema for ats_score_items
-- Creates the table if missing, and adds all columns safely if table already exists.

CREATE TABLE IF NOT EXISTS public.ats_score_items (
  id              SERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),
  scored_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  interview_id    TEXT NOT NULL,
  organization_id TEXT,
  resume_name     TEXT NOT NULL,
  resume_url      TEXT,
  overall_score   NUMERIC DEFAULT 0,
  category_scores JSONB,
  matched_skills  TEXT[],
  missing_skills  TEXT[],
  strengths       TEXT[],
  interview_focus_areas TEXT[],
  summary         TEXT,
  suggested_tag   TEXT,
  candidate_details         JSONB,
  candidate_profile         JSONB,
  jd_understanding          JSONB,
  experience_depth_analysis JSONB,
  swot_analysis             JSONB,
  experience_match          BOOLEAN,
  category_details          JSONB,
  CONSTRAINT ats_score_items_interview_resume_unique UNIQUE (interview_id, resume_name)
);

-- Add any columns that may already exist (safe to re-run)
ALTER TABLE public.ats_score_items
  ADD COLUMN IF NOT EXISTS organization_id           TEXT,
  ADD COLUMN IF NOT EXISTS resume_url                TEXT,
  ADD COLUMN IF NOT EXISTS scored_at                 TIMESTAMPTZ DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS category_scores           JSONB,
  ADD COLUMN IF NOT EXISTS matched_skills            TEXT[],
  ADD COLUMN IF NOT EXISTS missing_skills            TEXT[],
  ADD COLUMN IF NOT EXISTS strengths                 TEXT[],
  ADD COLUMN IF NOT EXISTS interview_focus_areas     TEXT[],
  ADD COLUMN IF NOT EXISTS summary                   TEXT,
  ADD COLUMN IF NOT EXISTS suggested_tag             TEXT,
  ADD COLUMN IF NOT EXISTS candidate_details         JSONB,
  ADD COLUMN IF NOT EXISTS candidate_profile         JSONB,
  ADD COLUMN IF NOT EXISTS jd_understanding          JSONB,
  ADD COLUMN IF NOT EXISTS experience_depth_analysis JSONB,
  ADD COLUMN IF NOT EXISTS swot_analysis             JSONB,
  ADD COLUMN IF NOT EXISTS experience_match          BOOLEAN,
  ADD COLUMN IF NOT EXISTS category_details          JSONB;

-- Add the unique constraint if it doesn't exist yet (required for upsert ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ats_score_items_interview_resume_unique'
      AND conrelid = 'public.ats_score_items'::regclass
  ) THEN
    ALTER TABLE public.ats_score_items
      ADD CONSTRAINT ats_score_items_interview_resume_unique
      UNIQUE (interview_id, resume_name);
  END IF;
END $$;

-- Drop NOT NULL from legacy columns that may block inserts
ALTER TABLE public.ats_score_items
  ALTER COLUMN scores DROP NOT NULL;

-- Grants
GRANT ALL ON TABLE public.ats_score_items TO anon, authenticated, service_role;
