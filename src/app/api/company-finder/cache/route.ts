import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { CachedCompany } from "@/types/company-finder";

const CACHE_TTL_DAYS = 30;

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

// POST: Lookup companies in cache
export async function POST(req: Request) {
  try {
    const body: { companyNames: string[] } = await req.json();

    if (!body.companyNames || body.companyNames.length === 0) {
      return NextResponse.json({ cached: [], misses: [] }, { status: 200 });
    }

    const supabase = getSupabaseClient();
    const normalizedKeys = body.companyNames.map(normalizeKey);

    const { data: rows, error } = await supabase
      .from("company_cache")
      .select("*")
      .in("normalized_key", normalizedKeys);

    if (error) {
      logger.error("Cache lookup error", { error });
      return NextResponse.json({ error: "Cache lookup failed" }, { status: 500 });
    }

    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - CACHE_TTL_DAYS);

    const cached: CachedCompany[] = [];
    const foundKeys = new Set<string>();

    for (const row of rows || []) {
      const enrichedAt = new Date(row.enriched_at);
      if (enrichedAt < staleCutoff) {
        // Stale — treat as miss
        continue;
      }
      foundKeys.add(row.normalized_key);
      cached.push({
        companyName: row.company_name,
        normalizedKey: row.normalized_key,
        companyType: row.company_type || "unknown",
        companyInfo: row.company_info || undefined,
        headquarters: row.headquarters || undefined,
        foundedYear: row.founded_year || undefined,
        countriesWorkedIn: row.countries_worked_in || [],
        isRelevant: row.is_relevant ?? false,
        enrichedAt: row.enriched_at,
      });
    }

    // Misses: names whose normalized key was not found (or was stale)
    const misses: string[] = [];
    for (let i = 0; i < body.companyNames.length; i++) {
      if (!foundKeys.has(normalizedKeys[i])) {
        misses.push(body.companyNames[i]);
      }
    }

    return NextResponse.json({ cached, misses }, { status: 200 });
  } catch (error: any) {
    logger.error("Cache POST error", { error: error?.message || String(error) });
    return NextResponse.json({ error: "Cache lookup failed" }, { status: 500 });
  }
}

// PUT: Upsert companies into cache
export async function PUT(req: Request) {
  try {
    const body: { companies: CachedCompany[] } = await req.json();

    if (!body.companies || body.companies.length === 0) {
      return NextResponse.json({ upserted: 0 }, { status: 200 });
    }

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    const rows = body.companies.map((c) => ({
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

    const { error } = await supabase
      .from("company_cache")
      .upsert(rows, { onConflict: "normalized_key" });

    if (error) {
      logger.error("Cache upsert error", { error });
      return NextResponse.json({ error: "Cache upsert failed" }, { status: 500 });
    }

    logger.info("Cache upserted", { count: rows.length });
    return NextResponse.json({ upserted: rows.length }, { status: 200 });
  } catch (error: any) {
    logger.error("Cache PUT error", { error: error?.message || String(error) });
    return NextResponse.json({ error: "Cache upsert failed" }, { status: 500 });
  }
}
