import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { normalizeCompanyKey } from "@/lib/normalize-company-key";
import {
  EXTRACTION_ONLY_SYSTEM_PROMPT,
  generateExtractionOnlyPrompt,
} from "@/lib/prompts/company-finder";
import { ApiUsageService } from "@/services/api-usage.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — matches Vercel max

const EXTRACT_MODEL = MODELS.GPT5_MINI;

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const normalizeKey = normalizeCompanyKey;

/** Retry wrapper — skips quota-exceeded 429s immediately, retries other 429/5xx with backoff */
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

      if (isQuotaExceeded) {
        logger.error(`[CF Extract] Quota exceeded (429) — skipping, not retrying.`);
        throw err;
      }

      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (isRetryable && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`[CF Extract] Retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}, status=${status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/**
 * POST /api/company-finder/scans/[id]/extract
 *
 * Stage A of the split pipeline:
 *   1. Claims up to `batchSize` (default 25) pending resume tasks from cf_job_tasks
 *   2. Extracts company names via Azure OpenAI (NLP only — no web search)
 *   3. Inserts mentions into cf_company_mentions (one row per resume×company)
 *   4. Inserts unique company names into cf_enrich_queue (ON CONFLICT DO NOTHING)
 *   5. Marks resume tasks as completed
 *
 * Returns:
 *   200 { processedCount, companiesQueued }          — batch processed
 *   200 { extractionDone: true, processedCount: 0 }  — all resume tasks complete
 *   202 { waiting: true }                            — tasks in-flight, wait and retry
 *   404 { message }                                  — no active job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 280s hard deadline — leaves 20s buffer before Vercel kills the fn at 300s
  const DEADLINE_MS = Date.now() + 280_000;
  const timeLeft = () => DEADLINE_MS - Date.now();

  try {
    const { id: scanId } = await params;
    const { batchSize = 5 } = await request.json().catch(() => ({}));
    const supabase = getSupabaseClient();

    // 1. Find active job
    const { data: job } = await supabase
      .from("cf_batch_jobs")
      .select("id, total_items")
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
      .select("organization_id")
      .eq("id", scanId)
      .single();
    const organizationId: string | undefined = scan?.organization_id || undefined;

    // 2. Reset stale tasks (stuck in "processing" for >3 min means the fn timed out)
    const staleThreshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { error: staleErr } = await supabase
      .from("cf_job_tasks")
      .update({ status: "pending" })
      .eq("job_id", job.id)
      .eq("status", "processing")
      .lt("updated_at", staleThreshold);

    // Fallback if updated_at column not yet added
    if (staleErr?.message?.includes("updated_at")) {
      await supabase
        .from("cf_job_tasks")
        .update({ status: "pending" })
        .eq("job_id", job.id)
        .eq("status", "processing")
        .lt("created_at", staleThreshold);
    }

    // 3. Claim pending tasks
    const { data: tasks } = await supabase
      .from("cf_job_tasks")
      .select("id, resume_name, resume_text, resume_url")
      .eq("job_id", job.id)
      .eq("status", "pending")
      .limit(batchSize);

    if (!tasks || tasks.length === 0) {
      const { count: inFlight } = await supabase
        .from("cf_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("status", "processing");

      if (inFlight && inFlight > 0) {
        return NextResponse.json({ waiting: true, processedCount: 0, companiesQueued: 0 }, { status: 202 });
      }

      // All resume tasks are done — signal to client that extraction is complete
      return NextResponse.json({ extractionDone: true, processedCount: 0, companiesQueued: 0 });
    }

    // 4. Atomically claim tasks (set updated_at so stale detection tracks when we started)
    const { data: claimed } = await supabase
      .from("cf_job_tasks")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", tasks.map((t: any) => t.id))
      .eq("status", "pending")
      .select("id");

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ waiting: true, processedCount: 0, companiesQueued: 0 }, { status: 202 });
    }

    const claimedIds = new Set(claimed.map((t: any) => t.id));
    const actualTasks = tasks.filter((t: any) => claimedIds.has(t.id));

    logger.info(`[CF Extract] Processing ${actualTasks.length} resumes for scan ${scanId}`);

    // 5. Extract company names via Azure OpenAI (NLP only — no web search)
    // 30k chars is enough to find all company names — we don't need full resume text for NLP
    const resumes = actualTasks.map((t: any) => ({
      name: t.resume_name,
      text: (t.resume_text || "").slice(0, 30_000),
    }));

    let extractedMentions: { companyName: string; resumeName: string; context: string }[] = [];

    try {
      const ac = new AbortController();
      const extractMs = Math.min(250_000, timeLeft() - 20_000);
      if (extractMs <= 0) throw new Error("No time left for extraction");
      const timer = setTimeout(() => ac.abort(), extractMs);

      const result = await callWithRetry(() =>
        getOpenAIClient().chat.completions.create(
          {
            model: EXTRACT_MODEL,
            max_completion_tokens: 16384,
            messages: [
              { role: "system", content: EXTRACTION_ONLY_SYSTEM_PROMPT },
              { role: "user", content: generateExtractionOnlyPrompt({ resumes }) },
            ],
          } as any,
          { signal: ac.signal }
        )
      );
      clearTimeout(timer);

      const raw = result.choices[0]?.message?.content || "{}";
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          extractedMentions = JSON.parse(match[0]).companies || [];
        } catch {
          let repaired = match[0].replace(/,\s*([\]}])/g, "$1");
          const ob = (repaired.match(/\{/g) || []).length;
          const cb = (repaired.match(/\}/g) || []).length;
          repaired += "}".repeat(Math.max(0, ob - cb));
          try { extractedMentions = JSON.parse(repaired).companies || []; } catch { /* give up */ }
        }
      }

      ApiUsageService.saveOpenAIUsage({
        category: "company_finder",
        organizationId,
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
        totalTokens: result.usage?.total_tokens || 0,
        model: EXTRACT_MODEL,
        metadata: { stage: "extraction", resumeCount: resumes.length, serverSide: true },
      }).catch(() => {});

    } catch (extractErr: any) {
      logger.error(`[CF Extract] Extraction failed: ${extractErr.message}`);
      await supabase
        .from("cf_job_tasks")
        .update({ status: "failed", error_message: extractErr.message })
        .in("id", actualTasks.map((t: any) => t.id));
      return NextResponse.json({ processedCount: 0, companiesQueued: 0, failedCount: actualTasks.length });
    }

    logger.info(`[CF Extract] Extracted ${extractedMentions.length} company mentions from ${actualTasks.length} resumes`);

    // 6. Save mentions + queue unique companies
    let companiesQueued = 0;

    if (extractedMentions.length > 0) {
      // Build a URL lookup from the tasks we just processed
      const urlMap: Record<string, string> = {};
      for (const t of actualTasks) {
        if (t.resume_url) urlMap[t.resume_name] = t.resume_url;
      }

      // Insert one row per mention into cf_company_mentions
      const mentionRows = extractedMentions
        .filter((e: any) => e.companyName?.trim())
        .map((e: any) => ({
          scan_id: scanId,
          normalized_key: normalizeKey(e.companyName),
          company_name: e.companyName.trim(),
          resume_name: e.resumeName || "",
          resume_url: urlMap[e.resumeName] || null,
          context: e.context || "",
        }));

      if (mentionRows.length > 0) {
        const { error: mentionErr } = await supabase
          .from("cf_company_mentions")
          .insert(mentionRows);
        if (mentionErr) logger.error(`[CF Extract] Mentions insert error: ${mentionErr.message}`);
      }

      // Deduplicate extracted companies by normalized key
      const seen = new Set<string>();
      const uniqueCompanies = extractedMentions.filter((e: any) => {
        if (!e.companyName?.trim()) return false;
        const key = normalizeKey(e.companyName);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Check company_cache for all unique companies in this batch
      const uniqueKeys = uniqueCompanies.map((e: any) => normalizeKey(e.companyName));
      const { data: cachedRows } = await supabase
        .from("company_cache")
        .select("*")
        .in("normalized_key", uniqueKeys);

      const cachedKeySet = new Set((cachedRows || []).map((r: any) => r.normalized_key));

      // Only queue cache misses — cached companies are handled below without web search
      const queueRows = uniqueCompanies
        .filter((e: any) => !cachedKeySet.has(normalizeKey(e.companyName)))
        .map((e: any) => ({
          scan_id: scanId,
          company_name: e.companyName.trim(),
          normalized_key: normalizeKey(e.companyName),
          status: "pending",
        }));

      if (queueRows.length > 0) {
        const { error: queueErr } = await supabase
          .from("cf_enrich_queue")
          .upsert(queueRows, { onConflict: "scan_id,normalized_key", ignoreDuplicates: true });
        if (queueErr) {
          logger.error(`[CF Extract] Queue upsert error: ${queueErr.message}`);
        } else {
          companiesQueued = queueRows.length;
        }
      }

      // For cache hits: build result objects immediately and save to scan (no web search needed)
      if (cachedRows && cachedRows.length > 0) {
        const cachedKeys = cachedRows.map((r: any) => r.normalized_key);

        const { data: mentionData } = await supabase
          .from("cf_company_mentions")
          .select("normalized_key, company_name, resume_name, resume_url, context")
          .eq("scan_id", scanId)
          .in("normalized_key", cachedKeys);

        const mentionMap = new Map<string, { sourceResumes: any[]; frequency: number }>();
        for (const m of (mentionData || [])) {
          const existing = mentionMap.get(m.normalized_key) || { sourceResumes: [], frequency: 0 };
          existing.sourceResumes.push({ resumeName: m.resume_name, resumeUrl: m.resume_url, context: m.context });
          existing.frequency = existing.sourceResumes.length;
          mentionMap.set(m.normalized_key, existing);
        }

        const { data: scanData } = await supabase
          .from("company_finder_scan")
          .select("results, resume_names, resume_urls")
          .eq("id", scanId)
          .single();

        const existingResults: any[] = scanData?.results || [];
        const existingUrls: Record<string, string> = scanData?.resume_urls || {};
        const existingNames = new Set<string>(scanData?.resume_names || []);

        const scannedAt = new Date().toISOString();
        const cachedResultObjects = cachedRows.map((row: any) => {
          const mentionInfo = mentionMap.get(row.normalized_key) || { sourceResumes: [], frequency: 1 };
          return {
            companyName: row.company_name,
            companyType: row.company_type || "unknown",
            companyInfo: row.company_info || "",
            headquarters: row.headquarters || "",
            foundedYear: row.founded_year || "",
            countriesWorkedIn: row.countries_worked_in || [],
            isRelevant: row.is_relevant ?? false,
            sourceResumes: mentionInfo.sourceResumes.map((s: any) => s.resumeName),
            resumeUrls: Object.fromEntries(
              mentionInfo.sourceResumes
                .filter((s: any) => s.resumeUrl)
                .map((s: any) => [s.resumeName, s.resumeUrl])
            ),
            contexts: mentionInfo.sourceResumes.map((s: any) => s.context).filter(Boolean),
            frequency: mentionInfo.frequency,
            scannedAt,
          };
        });

        const urlUpdates: Record<string, string> = { ...existingUrls };
        for (const m of (mentionData || [])) {
          if (m.resume_url) urlUpdates[m.resume_name] = m.resume_url;
          existingNames.add(m.resume_name);
        }

        const newKeys = new Set(cachedResultObjects.map((r: any) => normalizeKey(r.companyName)));
        const merged = [
          ...existingResults.filter((r: any) => !newKeys.has(normalizeKey(r.companyName))),
          ...cachedResultObjects,
        ].sort((a: any, b: any) => (b.frequency || 0) - (a.frequency || 0));

        const allNames = Array.from(existingNames);
        await supabase
          .from("company_finder_scan")
          .update({
            results: merged,
            resume_names: allNames,
            resume_count: allNames.length,
            company_count: merged.length,
            resume_urls: urlUpdates,
            updated_at: new Date().toISOString(),
          })
          .eq("id", scanId);

        logger.info(`[CF Extract] ${cachedRows.length} companies resolved from cache immediately`);
      }
    }

    // 7. Mark resume tasks as completed
    await supabase
      .from("cf_job_tasks")
      .update({ status: "completed" })
      .in("id", actualTasks.map((t: any) => t.id));

    // 8. Update job progress
    try {
      await supabase.rpc("increment_cf_job_progress", {
        job_uuid: job.id,
        processed_inc: actualTasks.length,
        failed_inc: 0,
      });
    } catch { /* non-critical */ }

    logger.info(`[CF Extract] Done: ${actualTasks.length} resumes processed, ${companiesQueued} companies queued for web search`);

    return NextResponse.json({ processedCount: actualTasks.length, companiesQueued });

  } catch (err: any) {
    logger.error("[CF Extract] Fatal:", err?.message);
    return NextResponse.json({ error: err?.message || "Extract failed" }, { status: 500 });
  }
}
