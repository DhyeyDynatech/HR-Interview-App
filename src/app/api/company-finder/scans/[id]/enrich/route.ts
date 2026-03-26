import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { getOpenAIClientDirect, DIRECT_MODELS } from "@/lib/openai-client";
import { normalizeCompanyKey } from "@/lib/normalize-company-key";
import {
  COMPANY_FINDER_SYSTEM_PROMPT,
  generateEnrichmentPrompt,
} from "@/lib/prompts/company-finder";
import { ApiUsageService } from "@/services/api-usage.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — each enrich call gets its own full budget

const CF_MODEL = DIRECT_MODELS.GPT5_MINI;
const ENRICH_BATCH = 5;                    // companies per enrich call — client runs 3 workers in parallel
const STALE_THRESHOLD_MS = 8 * 60 * 1000; // 8 min — > maxDuration, so only orphaned items reset

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const normalizeKey = normalizeCompanyKey;

/** Retry wrapper — handles OpenAI 5xx errors.
 *  429 quota-exceeded errors are NOT retried — they are thrown immediately. */
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      const isQuotaExceeded =
        status === 429 &&
        (err?.message?.toLowerCase().includes("quota") ||
          err?.message?.toLowerCase().includes("exceeded") ||
          err?.message?.toLowerCase().includes("billing"));

      // Skip immediately on quota errors — retrying won't help
      if (isQuotaExceeded) {
        logger.error(`[CF Enrich] Quota exceeded (429) — skipping, not retrying.`);
        throw err;
      }

      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (isRetryable && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`[CF Enrich] Retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}, status=${status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/**
 * POST /api/company-finder/scans/[id]/enrich
 *
 * Stage B of the split pipeline:
 *   1. Claims up to ENRICH_BATCH × ENRICH_CONCURRENCY (15) pending companies from cf_enrich_queue
 *   2. Checks company_cache for hits (skip web search for cached companies)
 *   3. Enriches cache misses via OpenAI Responses API with web_search (3 parallel batches of 5)
 *   4. Saves enriched data to company_cache
 *   5. Reads source mentions from cf_company_mentions and builds final result objects
 *   6. Merges results into company_finder_scan.results (visible to UI immediately)
 *   7. If no pending/in-flight companies AND extraction is done → marks job complete
 *
 * Returns:
 *   200 { enrichedCount, failedCount }              — batch processed
 *   200 { message: "All done" }                     — everything complete, job marked done
 *   202 { waiting: true }                           — no work available yet, retry later
 *   404 { message }                                 — no active job (already completed)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const DEADLINE_MS = Date.now() + 280_000; // 280s — 20s buffer before Vercel 300s kill
  const timeLeft = () => DEADLINE_MS - Date.now();

  try {
    const { id: scanId } = await params;
    await request.json().catch(() => ({})); // consume body
    const supabase = getSupabaseClient();

    // 1. Find active job
    const { data: job } = await supabase
      .from("cf_batch_jobs")
      .select("id")
      .eq("scan_id", scanId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!job) {
      return NextResponse.json({ message: "No active job" }, { status: 404 });
    }

    // Look up organization_id from the scan for usage tracking
    const { data: scan } = await supabase
      .from("company_finder_scan")
      .select("organization_id, name")
      .eq("id", scanId)
      .single();
    const organizationId: string | undefined = scan?.organization_id || undefined;
    // Scans created by the ATS pipeline are named "__ats__{interviewId}" — used to tag cost records
    const cfSource = scan?.name?.startsWith("__ats__") ? "ats_pipeline" : "standalone";

    // 2. Reset stale enrich queue items (stuck > 8 min means the fn timed out)
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    await supabase
      .from("cf_enrich_queue")
      .update({ status: "pending" })
      .eq("scan_id", scanId)
      .eq("status", "processing")
      .lt("updated_at", staleThreshold);

    // 3. Claim pending companies — 5 per call, client runs 3 workers in parallel
    const claimSize = ENRICH_BATCH; // 5
    const { data: queueItems } = await supabase
      .from("cf_enrich_queue")
      .select("id, company_name, normalized_key")
      .eq("scan_id", scanId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(claimSize);

    if (!queueItems || queueItems.length === 0) {
      // No pending items — check if we should wait or complete
      const { count: inFlight } = await supabase
        .from("cf_enrich_queue")
        .select("*", { count: "exact", head: true })
        .eq("scan_id", scanId)
        .eq("status", "processing");

      if (inFlight && inFlight > 0) {
        // Another worker has items in-flight — wait
        return NextResponse.json({ waiting: true, enrichedCount: 0, failedCount: 0 }, { status: 202 });
      }

      // Check if extraction is still running (more companies may be added to the queue)
      const { count: pendingResumes } = await supabase
        .from("cf_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id)
        .in("status", ["pending", "processing"]);

      if (pendingResumes && pendingResumes > 0) {
        // Extraction still running — more companies may come, wait
        return NextResponse.json({ waiting: true, enrichedCount: 0, failedCount: 0 }, { status: 202 });
      }

      // All extraction done, all enrichment done.
      // Check if ANY companies were ever queued — if none, extraction failed entirely.
      const { count: totalQueued } = await supabase
        .from("cf_enrich_queue")
        .select("*", { count: "exact", head: true })
        .eq("scan_id", scanId);

      const jobStatus = (totalQueued && totalQueued > 0) ? "completed" : "failed";
      await supabase
        .from("cf_batch_jobs")
        .update({ status: jobStatus, updated_at: new Date().toISOString() })
        .eq("id", job.id);

      logger.info(`[CF Enrich] All done for scan ${scanId} — job marked ${jobStatus} (${totalQueued ?? 0} companies were queued)`);
      return NextResponse.json({ message: "All done", enrichedCount: 0, failedCount: 0 });
    }

    // 4. Atomically claim items
    const { data: claimed } = await supabase
      .from("cf_enrich_queue")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", queueItems.map((q: any) => q.id))
      .eq("status", "pending")
      .select("id, company_name, normalized_key");

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ waiting: true, enrichedCount: 0, failedCount: 0 }, { status: 202 });
    }

    const claimedIds = new Set(claimed.map((q: any) => q.id));
    const actualItems = queueItems.filter((q: any) => claimedIds.has(q.id));
    const companyNames = actualItems.map((q: any) => q.company_name);

    logger.info(`[CF Enrich] Enriching ${companyNames.length} companies for scan ${scanId} (${Math.round(timeLeft() / 1000)}s remaining)`);

    // All companies reaching this point are guaranteed cache misses —
    // the extract route pre-filters cached companies and resolves them directly.
    const normalizedKeys = companyNames.map(normalizeKey);
    const cacheMissNames = companyNames;
    const enrichedCompanies: any[] = [];

    // 6. Enrich cache misses — single web search call, 5 companies max.
    //    Parallelism is handled by 3 concurrent client workers, each calling this route independently.
    let failedCount = 0;

    if (cacheMissNames.length > 0) {
      logger.info(`[CF Enrich] Web searching ${cacheMissNames.length} companies (${Math.round(timeLeft() / 1000)}s remaining)`);

      // Use almost all remaining time — leave 20s for DB saves
      const enrichMs = Math.min(250_000, timeLeft() - 20_000);

      try {
        const openaiDirect = getOpenAIClientDirect();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), enrichMs);

        let response: any;
        try {
          response = await callWithRetry(() =>
            openaiDirect.responses.create({
              model: CF_MODEL,
              instructions: COMPANY_FINDER_SYSTEM_PROMPT,
              tools: [{ type: "web_search" as any }],
              input: generateEnrichmentPrompt(cacheMissNames),
              max_output_tokens: 16384,
            } as any, { signal: ac.signal })
          );
        } finally {
          clearTimeout(timer);
        }

        const raw = (response as any).output_text || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            const companies = (parsed.companies || []).map((c: any) => ({
              ...c,
              countriesWorkedIn: Array.isArray(c.countriesWorkedIn)
                ? c.countriesWorkedIn
                : typeof c.countriesWorkedIn === "string"
                  ? c.countriesWorkedIn.split(/,\s*/).map((s: string) => s.trim()).filter(Boolean)
                  : [],
            }));
            enrichedCompanies.push(...companies);
          } catch { /* JSON parse failed */ }
        }

        const enrichUsage = (response as any).usage;
        const searchCalls = ((response as any).output || []).filter((o: any) => o.type === "web_search_call").length;
        ApiUsageService.saveOpenAIUsage({
          category: "company_finder",
          organizationId,
          inputTokens: enrichUsage?.input_tokens || 0,
          outputTokens: enrichUsage?.output_tokens || 0,
          totalTokens: (enrichUsage?.input_tokens || 0) + (enrichUsage?.output_tokens || 0),
          model: CF_MODEL,
          searchCalls,
          metadata: { stage: "enrichment", companyCount: cacheMissNames.length, serverSide: true, source: cfSource },
        }).catch(() => {});

      } catch (enrichErr: any) {
        logger.error(`[CF Enrich] Web search failed: ${enrichErr.message}`);
        failedCount += cacheMissNames.length;
      }

      // Cache newly enriched companies
      if (enrichedCompanies.length > 0) {
        const now = new Date().toISOString();
        const seen = new Set<string>();
        const cacheRows = enrichedCompanies
          .filter((c: any) => {
            const k = normalizeKey(c.companyName);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .map((c: any) => ({
            company_name: c.companyName,
            normalized_key: normalizeKey(c.companyName),
            company_type: c.companyType || "unknown",
            company_info: c.companyInfo || null,
            headquarters: c.headquarters || null,
            founded_year: c.foundedYear || null,
            countries_worked_in: c.countriesWorkedIn || [],
            is_relevant: c.isRelevant ?? false,
            enriched_at: now,
            created_at: now,
          }));

        supabase
          .from("company_cache")
          .upsert(cacheRows, { onConflict: "normalized_key" })
          .then(({ error }) => { if (error) logger.error("[CF Enrich] Cache upsert failed:", error.message); });
      }
    }

    // 7. Build result objects from enrichment + source mentions
    // Load all mentions for the claimed companies from cf_company_mentions
    const { data: mentions } = await supabase
      .from("cf_company_mentions")
      .select("normalized_key, company_name, resume_name, resume_url, context")
      .eq("scan_id", scanId)
      .in("normalized_key", normalizedKeys);

    // Build a map: normalizedKey → {sourceResumes[], frequency}
    const mentionMap = new Map<string, { sourceResumes: any[]; frequency: number }>();
    if (mentions) {
      for (const m of mentions) {
        const existing = mentionMap.get(m.normalized_key) || { sourceResumes: [], frequency: 0 };
        existing.sourceResumes.push({ resumeName: m.resume_name, resumeUrl: m.resume_url, context: m.context });
        existing.frequency = existing.sourceResumes.length;
        mentionMap.set(m.normalized_key, existing);
      }
    }

    // Build enrichment lookup
    const enrichMap = new Map<string, any>();
    for (const c of enrichedCompanies) {
      enrichMap.set(normalizeKey(c.companyName), c);
    }

    // Load existing scan results (to merge with)
    const { data: scanData } = await supabase
      .from("company_finder_scan")
      .select("results, resume_names, resume_urls")
      .eq("id", scanId)
      .single();

    const existingResults: any[] = scanData?.results || [];
    const existingUrls: Record<string, string> = scanData?.resume_urls || {};
    const existingNames: string[] = scanData?.resume_names || [];

    // Build URL and name updates from mentions
    const urlUpdates: Record<string, string> = { ...existingUrls };
    const newResumeNames = new Set(existingNames);
    if (mentions) {
      for (const m of mentions) {
        if (m.resume_url) urlUpdates[m.resume_name] = m.resume_url;
        newResumeNames.add(m.resume_name);
      }
    }

    // Build new result objects for the claimed companies
    const scannedAt = new Date().toISOString();
    const newResultObjects = actualItems.map((item: any) => {
      const enriched = enrichMap.get(item.normalized_key);
      const mentionData = mentionMap.get(item.normalized_key) || { sourceResumes: [], frequency: 1 };
      return {
        companyName: enriched?.companyName || item.company_name,
        companyType: enriched?.companyType || "unknown",
        companyInfo: enriched?.companyInfo || "",
        headquarters: enriched?.headquarters || "",
        foundedYear: enriched?.foundedYear || "",
        countriesWorkedIn: enriched?.countriesWorkedIn || [],
        isRelevant: enriched?.isRelevant ?? false,
        sourceResumes: mentionData.sourceResumes.map((s: any) => s.resumeName),
        resumeUrls: Object.fromEntries(
          mentionData.sourceResumes
            .filter((s: any) => s.resumeUrl)
            .map((s: any) => [s.resumeName, s.resumeUrl])
        ),
        contexts: mentionData.sourceResumes.map((s: any) => s.context).filter(Boolean),
        frequency: mentionData.frequency,
        scannedAt,
      };
    });

    // Merge with existing results (new results replace any existing entry with the same company)
    const newKeys = new Set(newResultObjects.map((r: any) => normalizeKey(r.companyName)));
    const merged = [
      ...existingResults.filter((r: any) => !newKeys.has(normalizeKey(r.companyName))),
      ...newResultObjects,
    ].sort((a: any, b: any) => (b.frequency || 0) - (a.frequency || 0));

    // 8. Save merged results to scan
    const allResumeNames = Array.from(newResumeNames);
    await supabase
      .from("company_finder_scan")
      .update({
        results: merged,
        resume_names: allResumeNames,
        resume_count: allResumeNames.length,
        company_count: merged.length,
        resume_urls: urlUpdates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scanId);

    // 9. Mark claimed items as completed (or failed for ones that weren't enriched)
    const enrichedKeys = new Set(enrichedCompanies.map((c: any) => normalizeKey(c.companyName)));
    const completedIds = actualItems
      .filter((q: any) => enrichedKeys.has(q.normalized_key))
      .map((q: any) => q.id);
    const failedIds = actualItems
      .filter((q: any) => !enrichedKeys.has(q.normalized_key))
      .map((q: any) => q.id);

    if (completedIds.length > 0) {
      await supabase
        .from("cf_enrich_queue")
        .update({ status: "completed" })
        .in("id", completedIds);
    }
    if (failedIds.length > 0) {
      await supabase
        .from("cf_enrich_queue")
        .update({ status: "failed", error_message: "Not returned by AI or timed out" })
        .in("id", failedIds);
      failedCount += failedIds.length;
    }

    const enrichedCount = completedIds.length;
    logger.info(`[CF Enrich] Done: ${enrichedCount} enriched, ${failedCount} failed (${Math.round(timeLeft() / 1000)}s remaining)`);

    return NextResponse.json({ enrichedCount, failedCount });

  } catch (err: any) {
    logger.error("[CF Enrich] Fatal:", err?.message);
    return NextResponse.json({ error: err?.message || "Enrich failed" }, { status: 500 });
  }
}
