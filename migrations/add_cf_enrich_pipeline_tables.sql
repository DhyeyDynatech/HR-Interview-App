-- New tables for the split Extract → Enrich pipeline.
-- This replaces the single /process route with two dedicated routes:
--   /extract  — NLP extraction only, no web search, fast (120s maxDuration)
--   /enrich   — web search enrichment, 5 companies/batch, full 300s maxDuration
--
-- cf_company_mentions: one row per (resume, company) mention found during extraction.
--   Used by the enrich route to build sourceResumes/contexts for each company result.
--
-- cf_enrich_queue: one row per unique company per scan, tracks enrichment status.
--   Populated by /extract (INSERT ... ON CONFLICT DO NOTHING).
--   Claimed and processed by /enrich workers.

-- ── cf_company_mentions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cf_company_mentions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id        UUID        NOT NULL,
  normalized_key TEXT        NOT NULL,
  company_name   TEXT        NOT NULL,
  resume_name    TEXT        NOT NULL,
  resume_url     TEXT,
  context        TEXT,
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_cf_company_mentions_scan
  ON public.cf_company_mentions(scan_id, normalized_key);

-- ── cf_enrich_queue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cf_enrich_queue (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id        UUID        NOT NULL,
  company_name   TEXT        NOT NULL,
  normalized_key TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  error_message  TEXT,
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ DEFAULT timezone('utc', now()),
  UNIQUE(scan_id, normalized_key)
);

CREATE INDEX IF NOT EXISTS idx_cf_enrich_queue_scan_status
  ON public.cf_enrich_queue(scan_id, status);

-- Auto-update updated_at on row changes (reuse existing trigger function)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cf_enrich_queue_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_cf_enrich_queue_updated_at
      BEFORE UPDATE ON public.cf_enrich_queue
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END;
$$;
