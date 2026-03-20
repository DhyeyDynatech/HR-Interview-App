import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { getOpenAIClient, getOpenAIClientDirect, MODELS, DIRECT_MODELS } from "@/lib/openai-client";
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

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Retry wrapper with exponential backoff for OpenAI 429/5xx errors */
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
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

    // 2. Reset stale tasks (processing for >10 min = likely timed out)
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("cf_job_tasks")
      .update({ status: "pending" })
      .eq("job_id", job.id)
      .eq("status", "processing")
      .lt("created_at", staleThreshold);

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

    // 4. Claim tasks atomically
    const { data: claimedTasks } = await supabase
      .from("cf_job_tasks")
      .update({ status: "processing" })
      .in("id", tasks.map((t: any) => t.id))
      .eq("status", "pending")
      .select("id");

    if (!claimedTasks || claimedTasks.length === 0) {
      return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
    }

    const claimedIds = new Set(claimedTasks.map((t: any) => t.id));
    const actualTasks = tasks.filter((t: any) => claimedIds.has(t.id));

    logger.info(`[CF Process] Processing ${actualTasks.length} resumes for scan ${scanId}`);

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
        const timer = setTimeout(() => abortController.abort(), 240_000);
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
        inputTokens: extractUsage?.prompt_tokens || 0,
        outputTokens: extractUsage?.completion_tokens || 0,
        totalTokens: extractUsage?.total_tokens || 0,
        model: EXTRACT_MODEL,
        metadata: { stage: "extraction", resumeCount: resumes.length, serverSide: true },
      }).catch(() => {});

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

      // ── STAGE C: Enrich cache misses via web search (with retry) ──
      let enrichedCompanies: any[] = [];
      if (cacheMisses.length > 0) {
        const ENRICH_BATCH = 5;
        const openaiDirect = getOpenAIClientDirect();

        for (let i = 0; i < cacheMisses.length; i += ENRICH_BATCH) {
          const batch = cacheMisses.slice(i, i + ENRICH_BATCH);
          try {
            const enrichPrompt = generateEnrichmentPrompt(batch);

            const enrichResult = await callWithRetry(async () => {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), 290_000);
              try {
                return await openaiDirect.responses.create(
                  {
                    model: CF_MODEL,
                    instructions: COMPANY_FINDER_SYSTEM_PROMPT,
                    tools: [{ type: "web_search" as any }],
                    input: enrichPrompt,
                    max_output_tokens: 65536,
                  } as any,
                  { signal: ac.signal }
                );
              } finally {
                clearTimeout(timer);
              }
            });

            const enrichRaw = (enrichResult as any).output_text || "{}";
            const enrichJson = enrichRaw.match(/\{[\s\S]*\}/);
            if (enrichJson) {
              try {
                const parsed = JSON.parse(enrichJson[0]);
                const companies = (parsed.companies || []).map((c: any) => {
                  // Normalize countriesWorkedIn
                  if (typeof c.countriesWorkedIn === "string") {
                    c.countriesWorkedIn = c.countriesWorkedIn.split(/,\s*/).map((s: string) => s.trim()).filter(Boolean);
                  } else if (!Array.isArray(c.countriesWorkedIn)) {
                    c.countriesWorkedIn = [];
                  }
                  return c;
                });
                enrichedCompanies.push(...companies);
              } catch {
                // JSON parse failed for this batch
              }
            }

            // Track enrich usage
            const enrichUsage = (enrichResult as any).usage;
            ApiUsageService.saveOpenAIUsage({
              category: "company_finder",
              inputTokens: enrichUsage?.input_tokens || 0,
              outputTokens: enrichUsage?.output_tokens || 0,
              totalTokens: (enrichUsage?.input_tokens || 0) + (enrichUsage?.output_tokens || 0),
              model: CF_MODEL,
              metadata: { stage: "enrichment", companyCount: batch.length, serverSide: true },
            }).catch(() => {});
          } catch (err) {
            logger.error(`[CF Process] Enrichment batch failed:`, err instanceof Error ? err.message : String(err));
          }
        }

        // Auto-cache enriched companies
        if (enrichedCompanies.length > 0) {
          const now = new Date().toISOString();
          const seen = new Set<string>();
          const cacheRows = enrichedCompanies
            .filter((c: any) => {
              const key = normalizeKey(c.companyName);
              if (seen.has(key)) return false;
              seen.add(key);
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
            .then(({ error }) => { if (error) logger.error("[CF Process] Cache upsert failed", error.message); });
        }
      }

      // ── MERGE: Build aggregated companies ──
      const enrichedMap = new Map<string, any>();
      for (const c of [...cachedCompanies, ...enrichedCompanies]) {
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

      // ── SAVE INCREMENTALLY: Merge with existing scan results ──
      const { data: scanData } = await supabase
        .from("company_finder_scan")
        .select("results, resume_names, resume_urls")
        .eq("id", scanId)
        .single();

      const existingResults: any[] = scanData?.results || [];
      const existingNames: string[] = scanData?.resume_names || [];
      const existingUrls: Record<string, string> = scanData?.resume_urls || {};

      // Merge companies
      const newKeys = new Set(newCompanies.map(c => normalizeKey(c.companyName)));
      const merged = [
        ...existingResults.filter((c: any) => !newKeys.has(normalizeKey(c.companyName))),
        ...newCompanies,
      ];
      merged.sort((a: any, b: any) => (b.frequency || 0) - (a.frequency || 0));

      // Merge resume names and URLs
      const batchResumeNames = actualTasks.map((t: any) => t.resume_name);
      const allResumeNames = Array.from(new Set([...existingNames, ...batchResumeNames]));
      const urlUpdates: Record<string, string> = { ...existingUrls };
      for (const t of actualTasks) {
        if (t.resume_url) urlUpdates[t.resume_name] = t.resume_url;
      }

      await supabase
        .from("company_finder_scan")
        .update({
          results: merged,
          resume_names: allResumeNames,
          resume_urls: urlUpdates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", scanId);

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

    logger.info(`[CF Process] Batch done: ${processedCount} processed, ${failedCount} failed`);

    return NextResponse.json({ processedCount, failedCount });
  } catch (error: any) {
    logger.error("[CF Process] Fatal error:", error?.message || String(error));
    return NextResponse.json({ error: error?.message || "Process failed" }, { status: 500 });
  }
}
