import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Backfill can run several ffmpeg transcodes back-to-back. Give it the full
// serverless ceiling (300 on Vercel Pro; drop to 60 on Hobby and use a smaller
// `limit` per call so each request finishes in time).
export const maxDuration = 300;

// Convert at most this many recordings per request. Each transcode is
// download + ffmpeg + upload (~5-10s), run sequentially, so a single request
// must stay under the function's maxDuration. 15 per call leaves comfortable
// headroom under 300s; the query is idempotent (already-converted rows drop
// out), so just call the endpoint again to process the next batch. The bulk
// response reports how many .webm remain via `attempted` vs total.
const DEFAULT_LIMIT = 15;

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;

  return { userId };
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");

  return createClient(url, key, {
    global: {
      fetch: (u: any, o: any = {}) => fetch(u, { ...o, cache: "no-store" }),
    },
  });
}

/**
 * Admin backfill: convert existing WebM interview recordings to MP3 so they
 * become seekable in the recruiter player. New interviews are transcoded
 * automatically at end-of-call; this handles the ones recorded before that
 * existed. Delegates the actual work to /api/transcode-recording per call_id,
 * so all the download/ffmpeg/upload/idempotency logic lives in one place.
 *
 * Body:
 *   { call_id: "vl-..." }  → convert exactly one recording (use this to verify
 *                            the transcode works before converting everything).
 *   { all: true, limit? }  → convert up to `limit` remaining .webm recordings.
 */
export async function POST(req: NextRequest) {
  const auth = await extractAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is allowed for a default {all:true} run below */
  }

  const origin = req.nextUrl.origin;

  // Helper: call the single-file transcode route and normalize its result.
  const transcodeOne = async (callId: string) => {
    try {
      const res = await fetch(`${origin}/api/transcode-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const json = await res.json().catch(() => ({}));

      return {
        call_id: callId,
        ok: res.ok,
        status: res.status,
        recording_url: json.recording_url,
        alreadyMp3: json.alreadyMp3 || false,
        error: res.ok ? undefined : json.error || `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        call_id: callId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // ── Single-file mode ──────────────────────────────────────────────────────
  if (body.call_id) {
    const result = await transcodeOne(String(body.call_id).trim());

    return NextResponse.json(
      { mode: "single", result },
      { status: result.ok ? 200 : 502 },
    );
  }

  // ── Bulk mode (default) ───────────────────────────────────────────────────
  const limit = Number.isInteger(body.limit)
    ? Math.max(1, Math.min(DEFAULT_LIMIT, body.limit))
    : DEFAULT_LIMIT;

  let rows: Array<{ call_id: string }> = [];
  try {
    const supabase = getServiceClient();
    // Find responses whose stored recording is still a .webm. The MP3 backfill
    // flips recording_url to .mp3, so re-running only picks up the remaining
    // unconverted ones — the query is naturally idempotent.
    const { data, error } = await supabase
      .from("response")
      .select("call_id, details")
      .not("call_id", "is", null)
      .like("details->>recording_url", "%.webm")
      .limit(limit);
    if (error) throw error;
    rows = (data || [])
      .map((r: any) => ({ call_id: r.call_id }))
      .filter((r) => !!r.call_id);
  } catch (err) {
    logger.error(
      "transcode backfill: failed to query webm recordings",
      err instanceof Error ? err.message : String(err),
    );

    return NextResponse.json(
      { error: "Failed to list recordings to convert" },
      { status: 500 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        mode: "bulk",
        converted: 0,
        results: [],
        message: "Nothing to convert",
      },
      { status: 200 },
    );
  }

  // Convert sequentially — each transcode is CPU + network heavy, and running
  // 40 ffmpeg processes in parallel inside one function would blow memory. This
  // is a one-off admin operation, so throughput doesn't matter.
  const results = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await transcodeOne(row.call_id));
  }

  const converted = results.filter((r) => r.ok && !r.alreadyMp3).length;
  const failed = results.filter((r) => !r.ok);

  logger.info("transcode backfill complete", {
    attempted: results.length,
    converted,
    failed: failed.length,
  });

  return NextResponse.json(
    {
      mode: "bulk",
      attempted: results.length,
      converted,
      failed: failed.length,
      results,
    },
    { status: 200 },
  );
}
