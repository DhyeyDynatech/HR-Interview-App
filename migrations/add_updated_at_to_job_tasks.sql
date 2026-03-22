-- Add updated_at to cf_job_tasks for proper stale detection
-- The stale reset in /process routes must use updated_at (set when task is claimed),
-- NOT created_at (set when task is queued — could be hours old).
ALTER TABLE public.cf_job_tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- Add updated_at to ats_job_tasks for the same reason
ALTER TABLE public.ats_job_tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- Auto-update updated_at on any row change (reuse the existing trigger function)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cf_job_tasks_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_cf_job_tasks_updated_at
      BEFORE UPDATE ON public.cf_job_tasks
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ats_job_tasks_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_ats_job_tasks_updated_at
      BEFORE UPDATE ON public.ats_job_tasks
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END;
$$;

-- Reset any tasks that are stuck in "processing" from before this migration.
-- These tasks were never going to complete because the process route timed out.
-- Resetting them to "pending" allows the next process call to pick them up.
UPDATE public.cf_job_tasks
  SET status = 'pending', updated_at = timezone('utc', now())
  WHERE status = 'processing';

UPDATE public.ats_job_tasks
  SET status = 'pending', updated_at = timezone('utc', now())
  WHERE status = 'processing';
