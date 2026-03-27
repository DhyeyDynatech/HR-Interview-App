import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * POST /api/company-finder/scans/[id]/retry-failed
 *
 * Resets all "failed" enrich queue items for this scan back to "pending"
 * so they can be picked up by enrich workers for one more attempt.
 *
 * Returns:
 *   200 { resetCount: N }  — N items reset (0 means nothing to retry)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanId } = await params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("cf_enrich_queue")
      .update({ status: "pending", error_message: null, updated_at: new Date().toISOString() })
      .eq("scan_id", scanId)
      .eq("status", "failed")
      .select("id");

    if (error) throw error;

    const resetCount = data?.length ?? 0;
    if (resetCount > 0) {
      logger.info(`[CF Retry] Reset ${resetCount} failed enrich items back to pending for scan ${scanId}`);
    }

    return NextResponse.json({ resetCount });
  } catch (err: any) {
    logger.error("[CF Retry] Error:", err?.message);
    return NextResponse.json({ error: err?.message || "Retry failed" }, { status: 500 });
  }
}
