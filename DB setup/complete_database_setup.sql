-- ============================================================
--  DynaTech HR Interviewer — Complete Database Setup
--  Run this single file on a fresh Supabase project to create
--  the entire schema from scratch.
--
--  Order of creation:
--    1. Extensions
--    2. Enum types
--    3. Functions & triggers helpers
--    4. Core tables (org, user, interviewer, interview, response, etc.)
--    5. Cost-tracking table (api_usage)
--    6. ATS Scoring tables
--    7. Company Finder tables
--    8. Sequences, defaults, PKs, FKs, indexes, triggers, grants
-- ============================================================


-- ────────────────────────────────────────────────────────────
--  1. EXTENSIONS
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_graphql        SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto          SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault    SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"       SCHEMA extensions;


-- ────────────────────────────────────────────────────────────
--  2. ENUM TYPES
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'manager', 'interviewer', 'viewer', 'marketing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE public.user_status AS ENUM ('active', 'inactive', 'pending', 'suspended');
  END IF;
END$$;


-- ────────────────────────────────────────────────────────────
--  3. HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- Automatically updates the updated_at column on any row change.
-- Reused by triggers across all tables that have an updated_at column.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Generates a short human-readable applicant ID (e.g. APP-A1B2C3D4).
CREATE OR REPLACE FUNCTION public.generate_applicant_id()
RETURNS TEXT AS $$
BEGIN
  RETURN 'APP-' || upper(substring(gen_random_uuid()::text, 1, 8));
END;
$$ LANGUAGE plpgsql;

-- Trigger function: auto-fills applicant_id on INSERT if not provided.
CREATE OR REPLACE FUNCTION public.auto_generate_applicant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.applicant_id IS NULL OR NEW.applicant_id = '' THEN
    NEW.applicant_id = public.generate_applicant_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ────────────────────────────────────────────────────────────
--  4. CORE TABLES
-- ────────────────────────────────────────────────────────────

-- organization
CREATE TABLE IF NOT EXISTS public.organization (
  id                    TEXT        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()),
  name                  TEXT,
  image_url             TEXT,
  allowed_responses_count INTEGER
);

-- user
CREATE TABLE IF NOT EXISTS public."user" (
  id            TEXT        PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ DEFAULT timezone('utc', now()),
  email         TEXT        NOT NULL UNIQUE,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  avatar_url    TEXT,
  organization_id TEXT      REFERENCES public.organization(id),
  role          public.user_role   DEFAULT 'viewer'::public.user_role,
  status        public.user_status DEFAULT 'active'::public.user_status,
  last_login    TIMESTAMPTZ,
  created_by    TEXT        REFERENCES public."user"(id),
  password_hash TEXT,
  reset_token   TEXT,
  reset_token_expires TIMESTAMPTZ
);

-- interviewer
CREATE TABLE IF NOT EXISTS public.interviewer (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now()),
  agent_id    TEXT,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL,
  image       TEXT        NOT NULL,
  audio       TEXT,
  empathy     INTEGER     NOT NULL,
  exploration INTEGER     NOT NULL,
  rapport     INTEGER     NOT NULL,
  speed       INTEGER     NOT NULL
);

-- interview
CREATE TABLE IF NOT EXISTS public.interview (
  id              TEXT        PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),
  name            TEXT,
  description     TEXT,
  objective       TEXT,
  organization_id TEXT        REFERENCES public.organization(id),
  user_id         TEXT        REFERENCES public."user"(id),
  interviewer_id  INTEGER     REFERENCES public.interviewer(id),
  is_active       BOOLEAN     DEFAULT true,
  is_anonymous    BOOLEAN     DEFAULT false,
  is_archived     BOOLEAN     DEFAULT false,
  logo_url        TEXT,
  theme_color     TEXT,
  url             TEXT,
  readable_slug   TEXT,
  questions       JSONB,
  quotes          JSONB       DEFAULT '[]'::jsonb,
  insights        TEXT[]      DEFAULT ARRAY[]::text[],
  respondents     TEXT[]      DEFAULT ARRAY[]::text[],
  question_count  INTEGER,
  response_count  INTEGER,
  time_duration   TEXT
);

-- interview_assignee
CREATE TABLE IF NOT EXISTS public.interview_assignee (
  id               SERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  first_name       TEXT        NOT NULL,
  last_name        TEXT        NOT NULL,
  email            TEXT        NOT NULL UNIQUE,
  phone            TEXT,
  avatar_url       TEXT,
  organization_id  TEXT        REFERENCES public.organization(id),
  interview_id     TEXT        REFERENCES public.interview(id),
  status           TEXT        DEFAULT 'active'
                               CHECK (status IN ('active', 'inactive', 'pending')),
  assigned_by      TEXT        REFERENCES public."user"(id),
  assigned_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),
  notes            TEXT,
  tag              TEXT,
  applicant_id     TEXT        UNIQUE,
  review_status    TEXT        DEFAULT 'NO_STATUS'
                               CHECK (review_status IN ('NO_STATUS', 'NOT_SELECTED', 'POTENTIAL', 'SELECTED')),
  allow_retake     BOOLEAN     DEFAULT true,
  interview_status TEXT        DEFAULT 'NOT_SENT'
                               CHECK (interview_status IN (
                                 'NOT_SENT', 'INTERVIEW_SENT', 'INTERVIEW_RESENT',
                                 'INTERVIEW_COMPLETED', 'AI_RESPONSE_CAPTURED',
                                 'REVIEWED', 'NOT_REVIEWED',
                                 'CANDIDATE_SELECTED', 'CANDIDATE_REJECTED'
                               )),
  resume_url       TEXT
);

-- response
CREATE TABLE IF NOT EXISTS public.response (
  id                    SERIAL PRIMARY KEY,
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()),
  interview_id          TEXT        REFERENCES public.interview(id),
  name                  TEXT,
  email                 TEXT,
  call_id               TEXT,
  candidate_status      TEXT,
  duration              INTEGER,
  details               JSONB,
  analytics             JSONB,
  is_analysed           BOOLEAN     DEFAULT false,
  is_ended              BOOLEAN     DEFAULT false,
  is_viewed             BOOLEAN     DEFAULT false,
  tab_switch_count      INTEGER,
  face_mismatch_count   INTEGER     DEFAULT 0,
  camera_off_count      INTEGER     DEFAULT 0,
  multiple_person_count INTEGER     DEFAULT 0,
  violations_summary    JSONB       DEFAULT '[]'::jsonb,
  face_mismatch_total   INTEGER     DEFAULT 0,
  camera_off_total      INTEGER     DEFAULT 0,
  multiple_person_total INTEGER     DEFAULT 0
);

-- feedback
CREATE TABLE IF NOT EXISTS public.feedback (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()),
  interview_id TEXT        REFERENCES public.interview(id),
  email        TEXT,
  feedback     TEXT,
  satisfaction INTEGER
);

-- user_activity_log
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now()),
  user_id       TEXT        REFERENCES public."user"(id),
  action        TEXT        NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  details       JSONB,
  ip_address    TEXT,
  user_agent    TEXT
);


-- ────────────────────────────────────────────────────────────
--  5. COST-TRACKING TABLE
-- ────────────────────────────────────────────────────────────

-- api_usage: one row per API call (OpenAI, Retell, Vercel).
-- Used by the Cost Analysis dashboard to calculate per-org spending.
CREATE TABLE IF NOT EXISTS public.api_usage (
  id              SERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),

  -- Linkage (all nullable for flexibility)
  organization_id TEXT,
  user_id         TEXT,
  interview_id    TEXT,
  response_id     INTEGER,

  -- Category for filtering & grouping
  category TEXT NOT NULL CHECK (category IN (
    'interview_creation',      -- Question generation when creating interview
    'interview_response',      -- Analytics after interview ends
    'insights',                -- Aggregate insights generation
    'communication_analysis',  -- Communication skill analysis
    'voice_call',              -- Retell voice call
    'blob_upload',             -- Vercel Blob storage uploads
    'ats_scoring',             -- ATS resume scoring against job description
    'company_finder'           -- Company extraction from resumes
  )),

  -- Service provider
  service TEXT NOT NULL CHECK (service IN ('openai', 'retell', 'vercel')),

  -- Token usage (OpenAI calls)
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,

  -- Duration (voice calls, in seconds)
  duration_seconds INTEGER,

  -- Calculated cost in USD
  cost_usd DECIMAL(10, 6) NOT NULL,

  -- Request metadata
  model       TEXT,    -- e.g. 'gpt-5-mini'
  request_id  TEXT,    -- call_id or other correlation ID
  metadata    JSONB    -- searchCalls, searchCost, tokenCost, etc.
);

COMMENT ON TABLE public.api_usage IS 'Tracks API usage and costs for OpenAI, Retell, and Vercel services';


-- ────────────────────────────────────────────────────────────
--  6. ATS SCORING TABLES
-- ────────────────────────────────────────────────────────────

-- ats_job_data: one row per (interview, org) — stores JD text + aggregate stats.
CREATE TABLE IF NOT EXISTS public.ats_job_data (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id    TEXT        NOT NULL,
  organization_id TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  jd_text         TEXT,
  jd_filename     TEXT,
  result_count    INTEGER     DEFAULT 0,
  avg_score       NUMERIC(5, 2) DEFAULT 0,
  CONSTRAINT unique_ats_job UNIQUE (interview_id, organization_id)
);

-- ats_batch_jobs: one batch job per ATS scoring run (one per interview per invocation).
CREATE TABLE IF NOT EXISTS public.ats_batch_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  interview_id    TEXT        NOT NULL,
  manager_id      TEXT,       -- invocation/request ID of the queue manager
  status          TEXT        NOT NULL DEFAULT 'processing'
                              CHECK (status IN ('processing', 'completed', 'cancelled')),
  total_items     INTEGER     NOT NULL DEFAULT 0,
  processed_items INTEGER     NOT NULL DEFAULT 0,
  failed_items    INTEGER     NOT NULL DEFAULT 0
);

-- ats_job_tasks: one row per resume within an ATS batch job.
CREATE TABLE IF NOT EXISTS public.ats_job_tasks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  job_id        UUID        NOT NULL REFERENCES public.ats_batch_jobs(id) ON DELETE CASCADE,
  resume_name   TEXT        NOT NULL,
  resume_text   TEXT,
  resume_url    TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_message TEXT
);

-- ats_score_items: final scored result, one row per (interview, resume).
CREATE TABLE IF NOT EXISTS public.ats_score_items (
  id              SERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()),
  scored_at       TIMESTAMPTZ DEFAULT timezone('utc', now()),
  interview_id    TEXT        NOT NULL,
  organization_id TEXT,
  resume_name     TEXT        NOT NULL,
  resume_url      TEXT,
  overall_score   NUMERIC     DEFAULT 0,
  category_scores JSONB,      -- { skills, experience, education, keywords }
  category_details JSONB,     -- per-category score + reasons
  matched_skills  TEXT[],
  missing_skills  TEXT[],
  strengths       TEXT[],
  interview_focus_areas TEXT[],
  summary         TEXT,
  suggested_tag   TEXT,
  candidate_details         JSONB,  -- { firstName, lastName, email, phone }
  candidate_profile         JSONB,  -- { name, currentRole, currentCompany, totalExperience, ... }
  jd_understanding          JSONB,  -- { roleOverview, keyResponsibilities[], criticalSkills[], ... }
  experience_depth_analysis JSONB,  -- { parameters: [{parameter, rating, observation}], keyObservations[] }
  swot_analysis             JSONB,  -- { strengths[], weaknesses[], opportunities[], risks[], finalHiringInsight }
  experience_match          BOOLEAN,
  CONSTRAINT ats_score_items_interview_resume_unique UNIQUE (interview_id, organization_id, resume_name)
);


-- ────────────────────────────────────────────────────────────
--  7. COMPANY FINDER TABLES
-- ────────────────────────────────────────────────────────────

-- company_finder_scan: one row per CF scan session per org.
CREATE TABLE IF NOT EXISTS public.company_finder_scan (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  organization_id TEXT,
  name            TEXT        NOT NULL,
  resume_names    TEXT[]      DEFAULT '{}',
  resume_urls     JSONB       DEFAULT '{}'::jsonb,   -- { resumeName: url }
  results         JSONB       DEFAULT '[]'::jsonb,   -- AggregatedCompany[]
  company_count   INTEGER     DEFAULT 0,
  resume_count    INTEGER     DEFAULT 0,
  CONSTRAINT idx_cf_scan_org_name UNIQUE (organization_id, name)
);

-- cf_batch_jobs: one batch job per CF scan processing run.
CREATE TABLE IF NOT EXISTS public.cf_batch_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  scan_id         UUID        NOT NULL REFERENCES public.company_finder_scan(id) ON DELETE CASCADE,
  manager_id      TEXT,       -- invocation/request ID of the queue manager
  status          TEXT        NOT NULL DEFAULT 'processing'
                              CHECK (status IN ('processing', 'completed', 'cancelled')),
  total_items     INTEGER     NOT NULL DEFAULT 0,
  processed_items INTEGER     NOT NULL DEFAULT 0,
  failed_items    INTEGER     NOT NULL DEFAULT 0
);

-- cf_job_tasks: one row per resume within a CF batch job.
CREATE TABLE IF NOT EXISTS public.cf_job_tasks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  job_id        UUID        NOT NULL REFERENCES public.cf_batch_jobs(id) ON DELETE CASCADE,
  resume_name   TEXT        NOT NULL,
  resume_text   TEXT,
  resume_url    TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT
);

-- cf_company_mentions: one row per (resume, company) found during extraction.
-- Used by the enrich route to build sourceResumes/contexts per company.
CREATE TABLE IF NOT EXISTS public.cf_company_mentions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  scan_id        UUID        NOT NULL REFERENCES public.company_finder_scan(id) ON DELETE CASCADE,
  normalized_key TEXT        NOT NULL,
  company_name   TEXT        NOT NULL,
  resume_name    TEXT        NOT NULL,
  resume_url     TEXT,
  context        TEXT
);

-- cf_enrich_queue: one row per unique company per scan — tracks enrichment status.
-- Populated by /extract (INSERT ... ON CONFLICT DO NOTHING), processed by /enrich.
CREATE TABLE IF NOT EXISTS public.cf_enrich_queue (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  scan_id        UUID        NOT NULL REFERENCES public.company_finder_scan(id) ON DELETE CASCADE,
  company_name   TEXT        NOT NULL,
  normalized_key TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message  TEXT,
  UNIQUE (scan_id, normalized_key)
);

-- company_cache: global cache of enriched company data — never web-search the same company twice.
CREATE TABLE IF NOT EXISTS public.company_cache (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enriched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_name     TEXT        NOT NULL,
  normalized_key   TEXT        NOT NULL UNIQUE,
  company_type     TEXT        DEFAULT 'unknown',
  company_info     TEXT,
  headquarters     TEXT,
  founded_year     TEXT,
  countries_worked_in TEXT[]   DEFAULT '{}',
  is_relevant      BOOLEAN     DEFAULT false
);


-- ────────────────────────────────────────────────────────────
--  8. INDEXES
-- ────────────────────────────────────────────────────────────

-- user
CREATE INDEX IF NOT EXISTS idx_user_email           ON public."user"(email);
CREATE INDEX IF NOT EXISTS idx_user_organization_id ON public."user"(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_status          ON public."user"(status);
CREATE INDEX IF NOT EXISTS idx_user_reset_token     ON public."user"(reset_token);

-- interview_assignee
CREATE INDEX IF NOT EXISTS idx_interview_assignee_email           ON public.interview_assignee(email);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_applicant_id    ON public.interview_assignee(applicant_id);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_interview_id    ON public.interview_assignee(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_organization_id ON public.interview_assignee(organization_id);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_status          ON public.interview_assignee(status);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_review_status   ON public.interview_assignee(review_status);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_interview_status ON public.interview_assignee(interview_status);
CREATE INDEX IF NOT EXISTS idx_interview_assignee_allow_retake    ON public.interview_assignee(allow_retake);

-- response
CREATE INDEX IF NOT EXISTS idx_response_violations ON public.response
  USING btree (((tab_switch_count + face_mismatch_count) + camera_off_count + multiple_person_count))
  WHERE ((tab_switch_count + face_mismatch_count + camera_off_count + multiple_person_count) > 0);

-- user_activity_log
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON public.user_activity_log(user_id);

-- api_usage
CREATE INDEX IF NOT EXISTS idx_api_usage_organization_id ON public.api_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id         ON public.api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_interview_id    ON public.api_usage(interview_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_response_id     ON public.api_usage(response_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_category        ON public.api_usage(category);
CREATE INDEX IF NOT EXISTS idx_api_usage_service         ON public.api_usage(service);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at      ON public.api_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_org_category_date
  ON public.api_usage(organization_id, category, created_at DESC);

-- ats_job_data
CREATE INDEX IF NOT EXISTS idx_ats_job_data_org ON public.ats_job_data(organization_id);

-- ats_batch_jobs
CREATE INDEX IF NOT EXISTS idx_ats_batch_jobs_interview_id ON public.ats_batch_jobs(interview_id);
CREATE INDEX IF NOT EXISTS idx_ats_batch_jobs_status       ON public.ats_batch_jobs(status);

-- ats_job_tasks
CREATE INDEX IF NOT EXISTS idx_ats_job_tasks_job_id ON public.ats_job_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_ats_job_tasks_status ON public.ats_job_tasks(job_id, status);

-- ats_score_items
CREATE INDEX IF NOT EXISTS idx_ats_score_items_interview_id ON public.ats_score_items(interview_id);
CREATE INDEX IF NOT EXISTS idx_ats_score_items_org          ON public.ats_score_items(organization_id);

-- company_finder_scan
CREATE INDEX IF NOT EXISTS idx_company_finder_scan_org        ON public.company_finder_scan(organization_id);
CREATE INDEX IF NOT EXISTS idx_company_finder_scan_created_at ON public.company_finder_scan(created_at DESC);

-- cf_batch_jobs
CREATE INDEX IF NOT EXISTS idx_cf_batch_jobs_scan_id ON public.cf_batch_jobs(scan_id);
CREATE INDEX IF NOT EXISTS idx_cf_batch_jobs_status  ON public.cf_batch_jobs(status);

-- cf_job_tasks
CREATE INDEX IF NOT EXISTS idx_cf_job_tasks_job_id ON public.cf_job_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_cf_job_tasks_status ON public.cf_job_tasks(job_id, status);

-- cf_company_mentions
CREATE INDEX IF NOT EXISTS idx_cf_company_mentions_scan ON public.cf_company_mentions(scan_id, normalized_key);

-- cf_enrich_queue
CREATE INDEX IF NOT EXISTS idx_cf_enrich_queue_scan_status ON public.cf_enrich_queue(scan_id, status);

-- company_cache
CREATE INDEX IF NOT EXISTS idx_company_cache_key ON public.company_cache(normalized_key);


-- ────────────────────────────────────────────────────────────
--  9. TRIGGERS
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Auto-generate applicant_id on interview_assignee INSERT
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_auto_generate_applicant_id') THEN
    EXECUTE 'CREATE TRIGGER trigger_auto_generate_applicant_id
      BEFORE INSERT ON public.interview_assignee
      FOR EACH ROW EXECUTE FUNCTION public.auto_generate_applicant_id()';
  END IF;

  -- updated_at triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_user_updated_at
      BEFORE UPDATE ON public."user"
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_interview_assignee_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_interview_assignee_updated_at
      BEFORE UPDATE ON public.interview_assignee
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ats_job_data_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_ats_job_data_updated_at
      BEFORE UPDATE ON public.ats_job_data
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ats_batch_jobs_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_ats_batch_jobs_updated_at
      BEFORE UPDATE ON public.ats_batch_jobs
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ats_job_tasks_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_ats_job_tasks_updated_at
      BEFORE UPDATE ON public.ats_job_tasks
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_company_finder_scan_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_company_finder_scan_updated_at
      BEFORE UPDATE ON public.company_finder_scan
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cf_batch_jobs_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_cf_batch_jobs_updated_at
      BEFORE UPDATE ON public.cf_batch_jobs
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cf_job_tasks_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_cf_job_tasks_updated_at
      BEFORE UPDATE ON public.cf_job_tasks
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cf_enrich_queue_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_cf_enrich_queue_updated_at
      BEFORE UPDATE ON public.cf_enrich_queue
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END$$;


-- ────────────────────────────────────────────────────────────
--  10. GRANTS
-- ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.update_updated_at_column()   TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.generate_applicant_id()      TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.auto_generate_applicant_id() TO anon, authenticated, service_role;

GRANT ALL ON TABLE public.organization          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public."user"                TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.interviewer           TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.interview             TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.interview_assignee    TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.response              TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.feedback              TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_activity_log     TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.api_usage             TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.ats_job_data          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.ats_batch_jobs        TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.ats_job_tasks         TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.ats_score_items       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.company_finder_scan   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.cf_batch_jobs         TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.cf_job_tasks          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.cf_company_mentions   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.cf_enrich_queue       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.company_cache         TO anon, authenticated, service_role;

-- Serial sequences (guarded: only grant if the sequence actually exists)
DO $$
DECLARE
  seq TEXT;
BEGIN
  FOREACH seq IN ARRAY ARRAY[
    'interviewer_id_seq',
    'interview_assignee_id_seq',
    'response_id_seq',
    'feedback_id_seq',
    'user_activity_log_id_seq',
    'api_usage_id_seq',
    'ats_score_items_id_seq'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_sequences
      WHERE schemaname = 'public' AND sequencename = seq
    ) THEN
      EXECUTE format(
        'GRANT ALL ON SEQUENCE public.%I TO anon, authenticated, service_role',
        seq
      );
    END IF;
  END LOOP;
END$$;

-- Default privileges for any future tables/sequences/functions
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;


-- ────────────────────────────────────────────────────────────
--  11. PUBLICATION (Supabase Realtime)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime OWNER TO postgres;
  END IF;
END$$;
