import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** GET /api/company-finder/scans/[id]/job-status — check if a CF batch job is active */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: scanId } = await params;
  const supabase = getSupabaseClient();

  const { data: job } = await supabase
    .from("cf_batch_jobs")
    .select("id, total_items, processed_items, failed_items")
    .eq("scan_id", scanId)
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    activeBatchJob: job
      ? {
          id: job.id,
          totalItems: job.total_items,
          processedItems: job.processed_items,
          failedItems: job.failed_items,
        }
      : null,
  });
}
