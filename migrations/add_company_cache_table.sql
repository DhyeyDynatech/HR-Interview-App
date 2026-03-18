-- Company Cache Table
-- Stores enriched company data (web-searched) so the same company
-- is never web-searched twice. Global scope — company info is universal.

CREATE TABLE IF NOT EXISTS public.company_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  company_type TEXT DEFAULT 'unknown',
  company_info TEXT,
  headquarters TEXT,
  founded_year TEXT,
  countries_worked_in TEXT[] DEFAULT '{}',
  is_relevant BOOLEAN DEFAULT false,
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_cache_key ON public.company_cache (normalized_key);
