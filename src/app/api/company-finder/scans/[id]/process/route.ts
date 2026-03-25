import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { getOpenAIClient, getOpenAIClientDirect, MODELS, DIRECT_MODELS } from "@/lib/openai-client";
import { normalizeCompanyKey } from "@/lib/normalize-company-key";
import {
  EXTRACTION_ONLY_SYSTEM_PROMPT,
  generateExtractionOnlyPrompt,
  COMPANY_FINDER_SYSTEM_PROMPT,
  generateEnrichmentPrompt,
} from "@/lib/prompts/company-finder";
import { ApiUsageService } from "@/services/api-usage.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EXTRACT_MODEL = MODELS.GPT5_MINI;
const CF_MODEL = DIRECT_MODELS.GPT5_MINI;

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const normalizeKey = normalizeCompanyKey;

/** Retry wrapper with exponential backoff for OpenAI 5xx errors.
 *  429 quota-exceeded errors are NOT retried — they are thrown immediately. */
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
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
        logger.error(`[CF Process] Quota exceeded (429) — skipping, not retrying.`);
        throw err;
      }

      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (isRetryable && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`[CF Process] Retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries}, status=${status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/**
 * POST /api/company-finder/scans/[id]/process
 * Claims a batch of resume tasks, runs Extract → Cache → Enrich pipeline,
 * saves results incrementally, and returns progress.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Global deadline — leave 20s buffer before Vercel's 300s maxDuration kills the fn
  const DEADLINE_MS = Date.now() + 280_000;
  const timeLeft = () => DEADLINE_MS - Date.now();

  try {
    const { id: scanId } = await params;
    const { batchSize = 10 } = await request.json().catch(() => ({}));
    const supabase = getSupabaseClient();

    // 1. Find active job for this scan
    const { data: job } = await supabase
      .from("cf_batch_jobs")
      .select("id, total_items, processed_items, failed_items, scan_id")
      .eq("scan_id", scanId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!job) {
      return NextResponse.json({ message: "No active job" }, { status: 404 });
    }

    // Look up organization_id from the scan for usage tracking
    const { data: scanRow } = await supabase
      .from("company_finder_scan")
      .select("organization_id")
      .eq("id", scanId)
      .single();
    const organizationId: string | undefined = scanRow?.organization_id || undefined;

    // 2. Reset stale tasks — use updated_at (set when claiming) not created_at.
    //    Threshold: 7 min (> Vercel maxDuration=5min, so only orphaned tasks are reset).
    const staleThreshold = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    const { error: staleError } = await supabase
      .from("cf_job_tasks")
      .update({ status: "pending" })
      .eq("job_id", job.id)
      .eq("status", "processing")
      .lt("updated_at", staleThreshold);

    // Fallback: if updated_at column doesn't exist yet, use created_at
    if (staleError && staleError.message?.includes("updated_at")) {
      await supabase
        .from("cf_job_tasks")
        .update({ status: "pending" })
        .eq("job_id", job.id)
        .eq("status", "processing")
        .lt("created_at", staleThreshold);
    }

    // 3. Fetch pending tasks
    const { data: tasks } = await supabase
      .from("cf_job_tasks")
      .select("id, resume_name, resume_text, resume_url")
      .eq("job_id", job.id)
      .eq("status", "pending")
      .limit(batchSize);

    if (!tasks || tasks.length === 0) {
      // Check if all done or still in-flight
      const { count: totalCount } = await supabase
        .from("cf_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id);

      if (!totalCount || totalCount === 0) {
        return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
      }

      const { count: inFlightCount } = await supabase
        .from("cf_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("status", "processing");

      if (inFlightCount && inFlightCount > 0) {
        return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
      }

      // All done — mark job completed
      await supabase
        .from("cf_batch_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", job.id);

      return NextResponse.json({ message: "All tasks processed", processedCount: 0, failedCount: 0 });
    }

    // 4. Claim tasks atomically — set updated_at so stale detection knows when processing started
    const { data: claimedTasks } = await supabase
      .from("cf_job_tasks")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", tasks.map((t: any) => t.id))
      .eq("status", "pending")
      .select("id");

    if (!claimedTasks || claimedTasks.length === 0) {
      return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
    }

    const claimedIds = new Set(claimedTasks.map((t: any) => t.id));
    const actualTasks = tasks.filter((t: any) => claimedIds.has(t.id));

    logger.info(`[CF Process] Processing ${actualTasks.length} resumes for scan ${scanId} (${Math.round(timeLeft() / 1000)}s remaining)`);

    let processedCount = 0;
    let failedCount = 0;

    try {
      // ── STAGE A: Extract company names from resumes ──
      const resumes = actualTasks.map((t: any) => ({
        name: t.resume_name,
        text: (t.resume_text || "").slice(0, 100_000),
      }));

      const openai = getOpenAIClient();
      const prompt = generateExtractionOnlyPrompt({ resumes });

      const extractResult = await callWithRetry(async () => {
        const abortController = new AbortController();
        // Respect global deadline — give extract at most 90s (or time left minus buffer)
        const extractMs = Math.min(90_000, timeLeft() - 30_000);
        if (extractMs <= 0) throw new Error("No time left for extraction");
        const timer = setTimeout(() => abortController.abort(), extractMs);
        try {
          return await openai.chat.completions.create(
            {
              model: EXTRACT_MODEL,
              max_completion_tokens: 16384,
              messages: [
                { role: "system", content: EXTRACTION_ONLY_SYSTEM_PROMPT },
                { role: "user", content: prompt },
              ],
            } as any,
            { signal: abortController.signal }
          );
        } finally {
          clearTimeout(timer);
        }
      });

      logger.info(`[CF Process] Extract done (${Math.round(timeLeft() / 1000)}s remaining)`);
      const extractRaw = extractResult.choices[0]?.message?.content || "{}";
      const extractJson = extractRaw.match(/\{[\s\S]*\}/);
      let extractedNames: { companyName: string; resumeName: string; context: string }[] = [];
      if (extractJson) {
        try {
          const parsed = JSON.parse(extractJson[0]);
          extractedNames = parsed.companies || [];
        } catch {
          // Try repair
          let repaired = extractJson[0].replace(/,\s*([\]}])/g, "$1");
          const ob = (repaired.match(/\{/g) || []).length;
          const cb = (repaired.match(/\}/g) || []).length;
          const obr = (repaired.match(/\[/g) || []).length;
          const cbr = (repaired.match(/\]/g) || []).length;
          repaired += "]".repeat(Math.max(0, obr - cbr));
          repaired += "}".repeat(Math.max(0, ob - cb));
          try { extractedNames = JSON.parse(repaired).companies || []; } catch { /* give up */ }
        }
      }

      // Track extract usage
      const extractUsage = extractResult.usage;
      ApiUsageService.saveOpenAIUsage({
        category: "company_finder",
        organizationId,
        inputTokens: extractUsage?.prompt_tokens || 0,
        outputTokens: extractUsage?.completion_tokens || 0,
        totalTokens: extractUsage?.total_tokens || 0,
        model: EXTRACT_MODEL,
        metadata: { stage: "extraction", resumeCount: resumes.length, serverSide: true },
      }).catch(() => {});

      logger.info(`[CF Process] Extracted ${extractedNames.length} company mentions from ${resumes.length} resumes`);

      // ── STAGE B: Cache lookup ──
      const uniqueNames = Array.from(new Set(extractedNames.map(c => c.companyName.trim()))).filter(Boolean);
      let cachedCompanies: any[] = [];
      let cacheMisses: string[] = uniqueNames;

      if (uniqueNames.length > 0) {
        const normalizedKeys = uniqueNames.map(normalizeKey);
        const { data: cacheRows } = await supabase
          .from("company_cache")
          .select("*")
          .in("normalized_key", normalizedKeys);

        if (cacheRows && cacheRows.length > 0) {
          const staleCutoff = new Date();
          staleCutoff.setDate(staleCutoff.getDate() - 30);
          const foundKeys = new Set<string>();

          for (const row of cacheRows) {
            if (new Date(row.enriched_at) >= staleCutoff) {
              foundKeys.add(row.normalized_key);
              cachedCompanies.push({
                companyName: row.company_name,
                companyType: row.company_type || "unknown",
                companyInfo: row.company_info || "",
                headquarters: row.headquarters || "",
                foundedYear: row.founded_year || "",
                countriesWorkedIn: row.countries_worked_in || [],
              });
            }
          }
          cacheMisses = uniqueNames.filter(n => !foundKeys.has(normalizeKey(n)));
        }
      }

      logger.info(`[CF Process] Cache: ${cachedCompanies.length} hits, ${cacheMisses.length} misses (${Math.round(timeLeft() / 1000)}s remaining)`);

      // ── Pre-load scan state once for incremental saves ──
      const { data: scanData } = await supabase
        .from("company_finder_scan")
        .select("results, resume_names, resume_urls")
        .eq("id", scanId)
        .single();

      let existingResults: any[] = scanData?.results || [];
      const existingNames: string[] = scanData?.resume_names || [];
      const existingUrls: Record<string, string> = scanData?.resume_urls || {};

      // Build resume name + URL updates (same for every save)
      const batchResumeNames = actualTasks.map((t: any) => t.resume_name);
      const allResumeNames = Array.from(new Set([...existingNames, ...batchResumeNames]));
      const urlUpdates: Record<string, string> = { ...existingUrls };
      for (const t of actualTasks) {
        if (t.resume_url) urlUpdates[t.resume_name] = t.resume_url;
      }

      /** Merge extractedNames with the given enrichment map and save to DB immediately */
      const saveProgress = async (enrichedSoFar: any[]) => {
        const enrichedMap = new Map<string, any>();
        for (const c of [...cachedCompanies, ...enrichedSoFar]) {
          enrichedMap.set(normalizeKey(c.companyName), c);
        }
        const companyMap = new Map<string, any>();
        const scannedAt = new Date().toISOString();
        for (const ext of extractedNames) {
          const key = normalizeKey(ext.companyName);
          const enriched = enrichedMap.get(key);
          const existing = companyMap.get(key);
          if (existing) {
            existing.contexts.push(ext.context);
            if (ext.resumeName && !existing.sourceResumes.includes(ext.resumeName)) {
              existing.sourceResumes.push(ext.resumeName);
            }
            existing.frequency = existing.sourceResumes.length;
          } else {
            companyMap.set(key, {
              companyName: enriched?.companyName || ext.companyName,
              companyType: enriched?.companyType || "unknown",
              companyInfo: enriched?.companyInfo || "",
              headquarters: enriched?.headquarters || "",
              foundedYear: enriched?.foundedYear || "",
              countriesWorkedIn: enriched?.countriesWorkedIn || [],
              technologies: [],
              relevantDomains: [],
              sourceResumes: ext.resumeName ? [ext.resumeName] : [],
              frequency: 1,
              contexts: [ext.context],
              scannedAt,
            });
          }
        }
        const newCompanies = Array.from(companyMap.values());
        const newKeys = new Set(newCompanies.map((c: any) => normalizeKey(c.companyName)));
        const merged = [
          ...existingResults.filter((c: any) => !newKeys.has(normalizeKey(c.companyName))),
          ...newCompanies,
        ];
        merged.sort((a: any, b: any) => (b.frequency || 0) - (a.frequency || 0));
        await supabase.from("company_finder_scan").update({
          results: merged,
          resume_names: allResumeNames,
          resume_urls: urlUpdates,
          updated_at: new Date().toISOString(),
        }).eq("id", scanId);
        existingResults = merged; // keep for next save so we don't regress
        return merged;
      };

      // ── STAGE C: Enrich cache misses — 3 concurrent batches of 5, save after each round ──
      const enrichedCompanies: any[] = [];

      if (cacheMisses.length > 0) {
        const ENRICH_BATCH = 5;
        const ENRICH_CONCURRENCY = 3;
        const openaiDirect = getOpenAIClientDirect();

        // Split into batches of 5
        const allBatches: string[][] = [];
        for (let i = 0; i < cacheMisses.length; i += ENRICH_BATCH) {
          allBatches.push(cacheMisses.slice(i, i + ENRICH_BATCH));
        }

        const totalRounds = Math.ceil(allBatches.length / ENRICH_CONCURRENCY);
        logger.info(`[CF Process] Enriching ${cacheMisses.length} companies: ${allBatches.length} batches × ${ENRICH_BATCH}, ${ENRICH_CONCURRENCY} concurrent = ${totalRounds} rounds`);

        for (let r = 0; r < allBatches.length; r += ENRICH_CONCURRENCY) {
          if (timeLeft() < 50_000) {
            logger.warn(`[CF Process] Deadline approaching — stopping after round ${Math.floor(r / ENRICH_CONCURRENCY)} of ${totalRounds}`);
            break;
          }

          const roundBatches = allBatches.slice(r, r + ENRICH_CONCURRENCY);
          const roundNum = Math.floor(r / ENRICH_CONCURRENCY) + 1;
          logger.info(`[CF Process] Round ${roundNum}/${totalRounds}: ${roundBatches.length} parallel batches (${Math.round(timeLeft() / 1000)}s left)`);

          // Timeout per batch — divide remaining time evenly across remaining rounds,
          // leaving 45s for DB saves. Cap at 180s (web search rarely needs more).
          const remainingRounds = totalRounds - (roundNum - 1);
          const enrichMs = Math.max(60_000, Math.min(180_000, Math.floor((timeLeft() - 45_000) / remainingRounds)));

          const roundResults = await Promise.allSettled(
            roundBatches.map(async (batch) => {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), enrichMs);
              try {
                return await callWithRetry(async () =>
                  openaiDirect.responses.create({
                    model: CF_MODEL,
                    instructions: COMPANY_FINDER_SYSTEM_PROMPT,
                    tools: [{ type: "web_search" as any }],
                    input: generateEnrichmentPrompt(batch),
                    max_output_tokens: 65536,
                  } as any, { signal: ac.signal })
                );
              } finally {
                clearTimeout(timer);
              }
            })
          );

          // Parse results from this round
          const roundCompanies: any[] = [];
          for (const result of roundResults) {
            if (result.status === "fulfilled") {
              const enrichRaw = (result.value as any).output_text || "{}";
              const enrichJson = enrichRaw.match(/\{[\s\S]*\}/);
              if (enrichJson) {
                try {
                  const parsed = JSON.parse(enrichJson[0]);
                  const companies = (parsed.companies || []).map((c: any) => {
                    if (typeof c.countriesWorkedIn === "string") {
                      c.countriesWorkedIn = c.countriesWorkedIn.split(/,\s*/).map((s: string) => s.trim()).filter(Boolean);
                    } else if (!Array.isArray(c.countriesWorkedIn)) {
                      c.countriesWorkedIn = [];
                    }
                    return c;
                  });
                  roundCompanies.push(...companies);
                } catch { /* JSON parse failed */ }
              }
              const enrichUsage = (result.value as any).usage;
              const searchCalls = ((result.value as any).output || []).filter((o: any) => o.type === "web_search_call").length;
              ApiUsageService.saveOpenAIUsage({
                category: "company_finder",
                organizationId,
                inputTokens: enrichUsage?.input_tokens || 0,
                outputTokens: enrichUsage?.output_tokens || 0,
                totalTokens: (enrichUsage?.input_tokens || 0) + (enrichUsage?.output_tokens || 0),
                model: CF_MODEL,
                searchCalls,
                metadata: { stage: "enrichment", companyCount: batch.length, round: roundNum, serverSide: true },
              }).catch(() => {});
            } else {
              logger.error(`[CF Process] Round ${roundNum} batch failed:`, result.reason?.message || String(result.reason));
            }
          }

          if (roundCompanies.length > 0) {
            enrichedCompanies.push(...roundCompanies);

            // Cache this round's companies immediately
            const now = new Date().toISOString();
            const seen = new Set<string>();
            const cacheRows = roundCompanies
              .filter((c: any) => { const k = normalizeKey(c.companyName); if (seen.has(k)) return false; seen.add(k); return true; })
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
            supabase.from("company_cache")
              .upsert(cacheRows, { onConflict: "normalized_key" })
              .then(({ error }) => { if (error) logger.error("[CF Process] Cache upsert failed", error.message); });

            // Save partial results to DB so the UI can show them immediately
            await saveProgress(enrichedCompanies);
            logger.info(`[CF Process] Round ${roundNum} saved: ${roundCompanies.length} companies enriched (${enrichedCompanies.length} total so far)`);
          }
        }
      }

      // ── Final save — includes unenriched companies (those that ran out of time) ──
      await saveProgress(enrichedCompanies);

      processedCount = actualTasks.length;

      // Mark tasks completed
      await supabase
        .from("cf_job_tasks")
        .update({ status: "completed" })
        .in("id", actualTasks.map((t: any) => t.id));

    } catch (err: any) {
      logger.error(`[CF Process] Batch failed:`, err?.message || String(err));
      failedCount = actualTasks.length;

      // Mark tasks as failed
      await supabase
        .from("cf_job_tasks")
        .update({ status: "failed", error_message: err?.message || "Unknown error" })
        .in("id", actualTasks.map((t: any) => t.id));
    }

    // Update job progress
    try {
      await supabase.rpc("increment_cf_job_progress", {
        job_uuid: job.id,
        processed_inc: processedCount,
        failed_inc: failedCount,
      });
    } catch { /* non-critical */ }

    logger.info(`[CF Process] Batch done: ${processedCount} processed, ${failedCount} failed (${Math.round(timeLeft() / 1000)}s remaining)`);

    return NextResponse.json({ processedCount, failedCount });
  } catch (error: any) {
    logger.error("[CF Process] Fatal error:", error?.message || String(error));
    return NextResponse.json({ error: error?.message || "Process failed" }, { status: 500 });
  }
}
