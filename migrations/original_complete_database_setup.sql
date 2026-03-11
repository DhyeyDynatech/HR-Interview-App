-- Create extensions if not exists
CREATE EXTENSION IF NOT EXISTS pg_graphql SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;


-- Functions already created earlier; ensure ownership
ALTER FUNCTION public.auto_generate_applicant_id() OWNER TO postgres;
ALTER FUNCTION public.generate_applicant_id() OWNER TO postgres;
ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;


-- Create tables if not exists
CREATE TABLE IF NOT EXISTS public.feedback (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  interview_id text,
  email text,
  feedback text,
  satisfaction integer
);

ALTER TABLE public.feedback OWNER TO postgres;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.feedback_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.feedback_id_seq OWNER TO postgres;
ALTER SEQUENCE public.feedback_id_seq OWNED BY public.feedback.id;


CREATE TABLE IF NOT EXISTS public.interview (
  id text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  name text,
  description text,
  objective text,
  organization_id text,
  user_id text,
  interviewer_id integer,
  is_active boolean DEFAULT true,
  is_anonymous boolean DEFAULT false,
  is_archived boolean DEFAULT false,
  logo_url text,
  theme_color text,
  url text,
  readable_slug text,
  questions jsonb,
  quotes jsonb DEFAULT '[]'::jsonb,
  insights text[] DEFAULT ARRAY[]::text[],
  respondents text[] DEFAULT ARRAY[]::text[],
  question_count integer,
  response_count integer,
  time_duration text
);
ALTER TABLE public.interview OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.interview_assignee (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  updated_at timestamptz DEFAULT timezone('utc', now()),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  avatar_url text,
  organization_id text,
  interview_id text,
  status text DEFAULT 'active'::text,
  assigned_by text,
  assigned_at timestamptz DEFAULT timezone('utc', now()),
  notes text,
  tag text,
  applicant_id text,
  review_status text DEFAULT 'NO_STATUS'::text,
  CONSTRAINT interview_assignee_review_status_check CHECK (review_status = ANY (ARRAY['NO_STATUS'::text,'NOT_SELECTED'::text,'POTENTIAL'::text,'SELECTED'::text])),
  CONSTRAINT interview_assignee_status_check CHECK (status = ANY (ARRAY['active'::text,'inactive'::text,'pending'::text]))
);
ALTER TABLE public.interview_assignee OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.interview_assignee_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.interview_assignee_id_seq OWNER TO postgres;
ALTER SEQUENCE public.interview_assignee_id_seq OWNED BY public.interview_assignee.id;

CREATE TABLE IF NOT EXISTS public.interviewer (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  agent_id text,
  name text NOT NULL,
  description text NOT NULL,
  image text NOT NULL,
  audio text,
  empathy integer NOT NULL,
  exploration integer NOT NULL,
  rapport integer NOT NULL,
  speed integer NOT NULL
);
ALTER TABLE public.interviewer OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.interviewer_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.interviewer_id_seq OWNER TO postgres;
ALTER SEQUENCE public.interviewer_id_seq OWNED BY public.interviewer.id;


CREATE TABLE IF NOT EXISTS public.organization (
  id text DEFAULT extensions.uuid_generate_v4() NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  name text,
  image_url text,
  allowed_responses_count integer
);
ALTER TABLE public.organization OWNER TO postgres;


CREATE TABLE IF NOT EXISTS public.response (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  interview_id text,
  name text,
  email text,
  call_id text,
  candidate_status text,
  duration integer,
  details jsonb,
  analytics jsonb,
  is_analysed boolean DEFAULT false,
  is_ended boolean DEFAULT false,
  is_viewed boolean DEFAULT false,
  tab_switch_count integer,
  face_mismatch_count integer DEFAULT 0,
  camera_off_count integer DEFAULT 0,
  multiple_person_count integer DEFAULT 0,
  violations_summary jsonb DEFAULT '[]'::jsonb
);
ALTER TABLE public.response OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.response_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.response_id_seq OWNER TO postgres;
ALTER SEQUENCE public.response_id_seq OWNED BY public.response.id;


CREATE TABLE IF NOT EXISTS public."user" (
  id text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  avatar_url text,
  organization_id text,
  role public.user_role DEFAULT 'viewer'::public.user_role,
  status public.user_status DEFAULT 'active'::public.user_status,
  last_login timestamptz,
  created_by text,
  updated_at timestamptz DEFAULT timezone('utc', now()),
  password_hash text
);
ALTER TABLE public."user" OWNER TO postgres;


CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  user_id text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  details jsonb,
  ip_address text,
  user_agent text
);
ALTER TABLE public.user_activity_log OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.user_activity_log_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.user_activity_log_id_seq OWNER TO postgres;
ALTER SEQUENCE public.user_activity_log_id_seq OWNED BY public.user_activity_log.id;


CREATE TABLE IF NOT EXISTS public.user_permissions (
  id integer NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()),
  user_id text,
  permission_name text NOT NULL,
  granted boolean DEFAULT true,
  granted_by text,
  granted_at timestamptz DEFAULT timezone('utc', now())
);
ALTER TABLE public.user_permissions OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.user_permissions_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.user_permissions_id_seq OWNER TO postgres;
ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;



-- Set defaults for id columns to use sequences where sequences exist
ALTER TABLE ONLY public.feedback ALTER COLUMN id SET DEFAULT nextval('public.feedback_id_seq'::regclass) ;
ALTER TABLE ONLY public.interview_assignee ALTER COLUMN id SET DEFAULT nextval('public.interview_assignee_id_seq'::regclass) ;
ALTER TABLE ONLY public.interviewer ALTER COLUMN id SET DEFAULT nextval('public.interviewer_id_seq'::regclass) ;
ALTER TABLE ONLY public.response ALTER COLUMN id SET DEFAULT nextval('public.response_id_seq'::regclass) ;
ALTER TABLE ONLY public.user_activity_log ALTER COLUMN id SET DEFAULT nextval('public.user_activity_log_id_seq'::regclass) ;
ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass) ;



-- Constraints: primary keys and uniques (add only if not already present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_pkey') THEN
    ALTER TABLE ONLY public.feedback ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_assignee_applicant_id_key') THEN
    ALTER TABLE ONLY public.interview_assignee ADD CONSTRAINT interview_assignee_applicant_id_key UNIQUE (applicant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_assignee_email_key') THEN
    ALTER TABLE ONLY public.interview_assignee ADD CONSTRAINT interview_assignee_email_key UNIQUE (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_assignee_pkey') THEN
    ALTER TABLE ONLY public.interview_assignee ADD CONSTRAINT interview_assignee_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_pkey') THEN
    ALTER TABLE ONLY public.interview ADD CONSTRAINT interview_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interviewer_pkey') THEN
    ALTER TABLE ONLY public.interviewer ADD CONSTRAINT interviewer_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_pkey') THEN
    ALTER TABLE ONLY public.organization ADD CONSTRAINT organization_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_pkey') THEN
    ALTER TABLE ONLY public.response ADD CONSTRAINT response_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_activity_log_pkey') THEN
    ALTER TABLE ONLY public.user_activity_log ADD CONSTRAINT user_activity_log_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_email_key') THEN
    ALTER TABLE ONLY public."user" ADD CONSTRAINT user_email_key UNIQUE (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_pkey') THEN
    ALTER TABLE ONLY public.user_permissions ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_pkey') THEN
    ALTER TABLE ONLY public."user" ADD CONSTRAINT user_pkey PRIMARY KEY (id);
  END IF;
END$$;



-- Indexes (create if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_applicant_id') THEN
    CREATE INDEX idx_interview_assignee_applicant_id ON public.interview_assignee USING btree (applicant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_email') THEN
    CREATE INDEX idx_interview_assignee_email ON public.interview_assignee USING btree (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_interview_id') THEN
    CREATE INDEX idx_interview_assignee_interview_id ON public.interview_assignee USING btree (interview_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_organization_id') THEN
    CREATE INDEX idx_interview_assignee_organization_id ON public.interview_assignee USING btree (organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_review_status') THEN
    CREATE INDEX idx_interview_assignee_review_status ON public.interview_assignee USING btree (review_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_interview_assignee_status') THEN
    CREATE INDEX idx_interview_assignee_status ON public.interview_assignee USING btree (status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_response_violations') THEN
    CREATE INDEX idx_response_violations ON public.response USING btree ((( ( (tab_switch_count + face_mismatch_count) + camera_off_count) + multiple_person_count ))) WHERE ((( (tab_switch_count + face_mismatch_count) + camera_off_count) + multiple_person_count) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_user_activity_log_user_id') THEN
    CREATE INDEX idx_user_activity_log_user_id ON public.user_activity_log USING btree (user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_user_email') THEN
    CREATE INDEX idx_user_email ON public."user" USING btree (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_user_organization_id') THEN
    CREATE INDEX idx_user_organization_id ON public."user" USING btree (organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_user_permissions_user_id') THEN
    CREATE INDEX idx_user_permissions_user_id ON public.user_permissions USING btree (user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_user_status') THEN
    CREATE INDEX idx_user_status ON public."user" USING btree (status);
  END IF;
END$$;


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_auto_generate_applicant_id') THEN
    PERFORM pg_catalog.set_config('search_path', 'public', false);
    EXECUTE 'CREATE TRIGGER trigger_auto_generate_applicant_id BEFORE INSERT ON public.interview_assignee FOR EACH ROW EXECUTE FUNCTION public.auto_generate_applicant_id()';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_interview_assignee_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_interview_assignee_updated_at BEFORE UPDATE ON public.interview_assignee FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON public."user" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END$$;


-- Add foreign keys if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'feedback_interview_id_fkey') THEN
    ALTER TABLE ONLY public.feedback
      ADD CONSTRAINT feedback_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interview(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_assignee_assigned_by_fkey') THEN
    ALTER TABLE ONLY public.interview_assignee
      ADD CONSTRAINT interview_assignee_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public."user"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_assignee_interview_id_fkey') THEN
    ALTER TABLE ONLY public.interview_assignee
      ADD CONSTRAINT interview_assignee_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interview(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_assignee_organization_id_fkey') THEN
    ALTER TABLE ONLY public.interview_assignee
      ADD CONSTRAINT interview_assignee_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_interviewer_id_fkey') THEN
    ALTER TABLE ONLY public.interview
      ADD CONSTRAINT interview_interviewer_id_fkey FOREIGN KEY (interviewer_id) REFERENCES public.interviewer(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_organization_id_fkey') THEN
    ALTER TABLE ONLY public.interview
      ADD CONSTRAINT interview_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'interview_user_id_fkey') THEN
    ALTER TABLE ONLY public.interview
      ADD CONSTRAINT interview_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'response_interview_id_fkey') THEN
    ALTER TABLE ONLY public.response
      ADD CONSTRAINT response_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interview(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'user_activity_log_user_id_fkey') THEN
    ALTER TABLE ONLY public.user_activity_log
      ADD CONSTRAINT user_activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'user_created_by_fkey') THEN
    ALTER TABLE ONLY public."user"
      ADD CONSTRAINT user_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'user_organization_id_fkey') THEN
    ALTER TABLE ONLY public."user"
      ADD CONSTRAINT user_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'user_permissions_granted_by_fkey') THEN
    ALTER TABLE ONLY public.user_permissions
      ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public."user"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.constraint_name = 'user_permissions_user_id_fkey') THEN
    ALTER TABLE ONLY public.user_permissions
      ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
  END IF;
END$$;


-- Change publication owner if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime OWNER TO postgres;
  END IF;
END$$;


-- Grants (use safe checks)
-- Note: GRANT ... TO role will succeed even if role already has permissions; running directly
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON FUNCTION public.auto_generate_applicant_id() TO anon;
GRANT ALL ON FUNCTION public.auto_generate_applicant_id() TO authenticated;
GRANT ALL ON FUNCTION public.auto_generate_applicant_id() TO service_role;

GRANT ALL ON FUNCTION public.generate_applicant_id() TO anon;
GRANT ALL ON FUNCTION public.generate_applicant_id() TO authenticated;
GRANT ALL ON FUNCTION public.generate_applicant_id() TO service_role;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;

GRANT ALL ON TABLE public.feedback TO anon;
GRANT ALL ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;

GRANT ALL ON SEQUENCE public.feedback_id_seq TO anon;
GRANT ALL ON SEQUENCE public.feedback_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.feedback_id_seq TO service_role;

GRANT ALL ON TABLE public.interview TO anon;
GRANT ALL ON TABLE public.interview TO authenticated;
GRANT ALL ON TABLE public.interview TO service_role;

GRANT ALL ON TABLE public.interview_assignee TO anon;
GRANT ALL ON TABLE public.interview_assignee TO authenticated;
GRANT ALL ON TABLE public.interview_assignee TO service_role;

GRANT ALL ON SEQUENCE public.interview_assignee_id_seq TO anon;
GRANT ALL ON SEQUENCE public.interview_assignee_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.interview_assignee_id_seq TO service_role;

GRANT ALL ON TABLE public.interviewer TO anon;
GRANT ALL ON TABLE public.interviewer TO authenticated;
GRANT ALL ON TABLE public.interviewer TO service_role;

GRANT ALL ON SEQUENCE public.interviewer_id_seq TO anon;
GRANT ALL ON SEQUENCE public.interviewer_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.interviewer_id_seq TO service_role;

GRANT ALL ON TABLE public.organization TO anon;
GRANT ALL ON TABLE public.organization TO authenticated;
GRANT ALL ON TABLE public.organization TO service_role;

GRANT ALL ON TABLE public.response TO anon;
GRANT ALL ON TABLE public.response TO authenticated;
GRANT ALL ON TABLE public.response TO service_role;

GRANT ALL ON SEQUENCE public.response_id_seq TO anon;
GRANT ALL ON SEQUENCE public.response_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.response_id_seq TO service_role;

GRANT ALL ON TABLE public."user" TO anon;
GRANT ALL ON TABLE public."user" TO authenticated;
GRANT ALL ON TABLE public."user" TO service_role;

GRANT ALL ON TABLE public.user_activity_log TO anon;
GRANT ALL ON TABLE public.user_activity_log TO authenticated;
GRANT ALL ON TABLE public.user_activity_log TO service_role;

GRANT ALL ON SEQUENCE public.user_activity_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_activity_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_activity_log_id_seq TO service_role;

GRANT ALL ON TABLE public.user_permissions TO anon;
GRANT ALL ON TABLE public.user_permissions TO authenticated;
GRANT ALL ON TABLE public.user_permissions TO service_role;

GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO service_role;

-- Default privileges
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- 23-12-2025: Added allow_retake flag to interview_assignee

-- Migration: Add allow_retake flag to interview_assignee
-- Purpose:
--  - Prevent assignees from taking an interview multiple times
--    unless a recruiter explicitly allows it again.
--  - Frontend will use this flag to block starting a new interview.

-- Add boolean flag to control whether an assignee can take (or retake) an interview
ALTER TABLE interview_assignee
ADD COLUMN IF NOT EXISTS allow_retake BOOLEAN DEFAULT TRUE;

-- Optional index to make lookups by this flag more efficient
CREATE INDEX IF NOT EXISTS idx_interview_assignee_allow_retake
  ON interview_assignee(allow_retake);



-- Migration: Add interview_status field to track interview progress
-- This migration adds a field to track the current status of the interview process

-- Add interview_status column with CHECK constraint
ALTER TABLE interview_assignee 
ADD COLUMN IF NOT EXISTS interview_status TEXT 
CHECK (interview_status IN ('NOT_SENT', 'INTERVIEW_SENT', 'INTERVIEW_RESENT', 'INTERVIEW_COMPLETED', 'AI_RESPONSE_CAPTURED', 'REVIEWED', 'NOT_REVIEWED', 'CANDIDATE_SELECTED', 'CANDIDATE_REJECTED'));

-- Set default value for interview_status
ALTER TABLE interview_assignee 
ALTER COLUMN interview_status SET DEFAULT 'NOT_SENT';

-- Create index on interview_status for faster filtering
CREATE INDEX IF NOT EXISTS idx_interview_assignee_interview_status ON interview_assignee(interview_status);

-- Update existing records: if they have an interview_id but no status, set to NOT_SENT
UPDATE interview_assignee
SET interview_status = 'NOT_SENT'
WHERE interview_status IS NULL AND interview_id IS NOT NULL;

-- Update existing records: if they have completed interview (has response), set to INTERVIEW_COMPLETED
UPDATE interview_assignee ia
SET interview_status = 'INTERVIEW_COMPLETED'
WHERE interview_status IN ('NOT_SENT', 'INTERVIEW_SENT', 'INTERVIEW_RESENT')
AND EXISTS (
  SELECT 1 FROM response r 
  WHERE r.interview_id = ia.interview_id 
  AND r.email = ia.email 
  AND r.is_ended = true
);

-- Update existing records: if they have review_status set, update interview_status accordingly
UPDATE interview_assignee
SET interview_status = CASE 
  WHEN review_status = 'SELECTED' THEN 'CANDIDATE_SELECTED'
  WHEN review_status = 'NOT_SELECTED' THEN 'CANDIDATE_REJECTED'
  ELSE interview_status
END
WHERE review_status IN ('SELECTED', 'NOT_SELECTED');

COMMENT ON COLUMN interview_assignee.interview_status IS 'Tracks the current status of the interview process: NOT_SENT, INTERVIEW_SENT, INTERVIEW_RESENT, INTERVIEW_COMPLETED, AI_RESPONSE_CAPTURED, REVIEWED, NOT_REVIEWED, CANDIDATE_SELECTED, CANDIDATE_REJECTED';



ALTER TABLE response 
ADD COLUMN IF NOT EXISTS face_mismatch_total INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS camera_off_total INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS multiple_person_total INTEGER DEFAULT 0;

COMMENT ON COLUMN response.face_mismatch_total IS 'Total number of face verification attempts performed during interview';
COMMENT ON COLUMN response.camera_off_total IS 'Total number of camera status checks performed during interview';
COMMENT ON COLUMN response.multiple_person_total IS 'Total number of multiple person detection checks performed during interview';

-- 05-01-2026: Added resume_url field to interview_assignee table
-- Migration: Add resume_url field to interview_assignee table
-- This migration adds support for optional resume/CV uploads for assignees

-- Add resume_url column to interview_assignee table
ALTER TABLE interview_assignee 
ADD COLUMN IF NOT EXISTS resume_url TEXT;

-- Add comment to document the field
COMMENT ON COLUMN interview_assignee.resume_url IS 'Optional URL to the assignee resume/CV PDF file';

-- Forgot Password Migration:
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS reset_token TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP WITH TIME ZONE;

-- Create index on reset_token for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_reset_token ON public."user"(reset_token);



----- Not Migrated Yet  Cost Analysis Functionality-----
-- Migration: Create api_usage table for comprehensive cost tracking
-- This table stores real API usage data (tokens, duration) for cost analysis

-- Create the api_usage table
CREATE TABLE IF NOT EXISTS public.api_usage (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),

  -- Linkage columns (nullable for flexibility)
  organization_id TEXT,
  user_id TEXT,
  interview_id TEXT,
  response_id INTEGER,

  -- Category for filtering and grouping
  category TEXT NOT NULL CHECK (category IN (
    'interview_creation',      -- Question generation when creating interview
    'interview_response',      -- Analytics generation after interview ends
    'insights',               -- Aggregate insights generation
    'communication_analysis', -- Communication skill analysis
    'voice_call'              -- Retell voice call
  )),

  -- Service provider
  service TEXT NOT NULL CHECK (service IN ('openai', 'retell')),

  -- Token usage (for OpenAI calls)
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,

  -- Duration (for voice calls, in seconds)
  duration_seconds INTEGER,

  -- Calculated cost in USD
  cost_usd DECIMAL(10, 6) NOT NULL,

  -- Request metadata
  model TEXT,                 -- e.g., 'gpt-4o'
  request_id TEXT,            -- For debugging/correlation (e.g., call_id)
  metadata JSONB              -- Additional context if needed
);

-- Add table comment
COMMENT ON TABLE public.api_usage IS 'Tracks API usage and costs for OpenAI and Retell services';

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_api_usage_organization_id ON public.api_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON public.api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_interview_id ON public.api_usage(interview_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_response_id ON public.api_usage(response_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_category ON public.api_usage(category);
CREATE INDEX IF NOT EXISTS idx_api_usage_service ON public.api_usage(service);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON public.api_usage(created_at);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_api_usage_org_category_date
  ON public.api_usage(organization_id, category, created_at DESC);

-- Grant permissions
ALTER TABLE public.api_usage OWNER TO postgres;

GRANT ALL ON TABLE public.api_usage TO anon;
GRANT ALL ON TABLE public.api_usage TO authenticated;
GRANT ALL ON TABLE public.api_usage TO service_role;
GRANT ALL ON SEQUENCE public.api_usage_id_seq TO anon;
GRANT ALL ON SEQUENCE public.api_usage_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.api_usage_id_seq TO service_role;

-- Enable Row Level Security (optional - uncomment if needed)
-- ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can view their organization's usage" ON public.api_usage
--   FOR SELECT USING (organization_id = current_setting('app.current_organization_id', true));


-- Migration: Fix api_usage table constraints
-- This migration updates the CHECK constraints to include all categories and services

-- Drop the existing constraints
ALTER TABLE public.api_usage DROP CONSTRAINT IF EXISTS api_usage_category_check;
ALTER TABLE public.api_usage DROP CONSTRAINT IF EXISTS api_usage_service_check;

-- Add updated category constraint with all values
ALTER TABLE public.api_usage ADD CONSTRAINT api_usage_category_check
  CHECK (category IN (
    'interview_creation',      -- Question generation when creating interview
    'interview_response',      -- Analytics generation after interview ends
    'insights',               -- Aggregate insights generation
    'communication_analysis', -- Communication skill analysis
    'voice_call',             -- Retell voice call
    'call_creation',          -- Retell call registration (zero cost, for visibility)
    'blob_upload'             -- Vercel Blob storage uploads
  ));

-- Add updated service constraint with all values
ALTER TABLE public.api_usage ADD CONSTRAINT api_usage_service_check
  CHECK (service IN ('openai', 'retell', 'vercel'));
