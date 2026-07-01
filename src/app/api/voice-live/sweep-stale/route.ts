import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";

export const dynamic = "force-dynamic";

/**
 * Server-side watchdog for Voice Live interviews that never got finalized.
 *
 * WHY THIS EXISTS
 * The Voice Live audio socket runs browser → Azure directly; our server is
 * never in that path, so it cannot tear down a live call. Every in-call time
 * cap (the React countdown and the VoiceLiveClient setTimeout) therefore runs
 * in the candidate's tab. If that tab is suspended, crashed, or killed (device
 * sleep, OOM, power loss), those timers can't fire and the response row is
 * left stuck at is_ended=false — invisible to recruiters and never analysed.
 *
 * This endpoint is the server-side guarantee: run it on a schedule (cron) and
 * it finalizes any Voice Live row that has been open longer than its
 * interview's time_duration plus a grace margin. It marks the row ended and
 * visible, runs analytics from whatever transcript exists, and records that
 * the finalize was server-forced (details.finalized_by = "server_sweep").
 *
 * It does NOT and cannot stop a live audio session — but it guarantees the
 * RECORD is never left open past the limit, which is the part the browser
 * can't promise.
 *
 * AUTH: protected by the CRON_SECRET env var (Bearer token or ?secret=). The
 * route is under /api/voice-live which middleware treats as public (no JWT),
 * so this secret is what gates it. Returns 401 if the secret is missing or
 * wrong. If CRON_SECRET is unset the route refuses to run (fail closed).
 */

// Extra margin beyond the interview's nominal limit before we force-finalize.
// Must comfortably exceed the in-call hard cap's own grace (30s) plus the
// end-of-call save + analytics window, so we only ever sweep rows the browser
// genuinely failed to finalize — never one that's mid-teardown.
const SWEEP_GRACE_MS = 5 * 60 * 1000; // 5 minutes

// Absolute floor: never finalize a row younger than this, regardless of the
// interview's configured duration (guards against a misconfigured 0/1-min
// interview causing us to kill still-live calls).
const MIN_AGE_MS = 3 * 60 * 1000; // 3 minutes

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL/key not configured");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "cache-control": "no-store" } },
  });
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no secret configured, no sweeping

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const querySecret = req.nextUrl.searchParams.get("secret") || "";

  return bearer === secret || querySecret === secret;
}

async function runSweep(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (err) {
    logger.error(
      "sweep-stale: supabase not configured",
      err instanceof Error ? err.message : String(err),
    );

    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  // 1. Pull candidate rows: Voice Live, not yet ended, older than the absolute
  //    floor. We then filter each against its own interview's time_duration.
  //    Bounded to a reasonable batch so a single run can't blow up.
  const floorIso = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const { data: rows, error } = await supabase
    .from("response")
    .select("id, call_id, interview_id, created_at, email, details, name")
    .eq("is_ended", false)
    .lt("created_at", floorIso)
    .like("call_id", "vl-%")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    logger.error("sweep-stale: query failed", error.message);

    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ swept: 0, checked: 0 }, { status: 200 });
  }

  // Cache interview durations so we don't refetch the same interview per row.
  const durationCache = new Map<string, number>();
  const getLimitMinutes = async (interviewId: string): Promise<number> => {
    if (durationCache.has(interviewId)) {
      return durationCache.get(interviewId)!;
    }
    const { data: interview } = await supabase
      .from("interview")
      .select("time_duration")
      .eq("id", interviewId)
      .single();
    const mins = Number(interview?.time_duration) || 0;
    durationCache.set(interviewId, mins);

    return mins;
  };

  const now = Date.now();
  let swept = 0;
  const sweptCallIds: string[] = [];

  for (const row of rows) {
    try {
      if (!row.interview_id || !row.created_at) continue;

      const limitMinutes = await getLimitMinutes(row.interview_id);
      if (limitMinutes <= 0) continue; // unknown limit — leave it alone

      const ageMs = now - new Date(row.created_at).getTime();
      const deadlineMs = limitMinutes * 60_000 + SWEEP_GRACE_MS;
      if (ageMs < deadlineMs) continue; // still within limit + grace

      // This row is genuinely overdue. Finalize it. Use whatever transcript
      // was persisted (there usually isn't one — if there were, the normal
      // save path would have set is_ended=true already); run analytics only
      // if a transcript exists.
      const existingDetails = (row.details as any) || {};
      const transcriptString: string | undefined = existingDetails.transcript;

      let analytics: any = null;
      if (transcriptString) {
        try {
          const result = await generateInterviewAnalytics({
            callId: row.call_id,
            interviewId: row.interview_id,
            transcript: transcriptString,
          });
          analytics = result.analytics;
        } catch (err) {
          logger.error(
            `sweep-stale: analytics failed for ${row.call_id}`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      const mergedDetails = {
        ...existingDetails,
        source: existingDetails.source || "azure-voicelive",
        finalized_by: "server_sweep",
        finalized_at: new Date().toISOString(),
        // Ensure the dashboard visibility filter (details->call_analysis) is
        // satisfied even when there was no transcript to analyse.
        call_analysis: existingDetails.call_analysis || {
          call_summary: analytics?.softSkillSummary || "",
          user_sentiment: analytics?.userSentiment || "Unknown",
          call_successful: true,
        },
        // If the recorder streamed chunks but the row was never finalized, the
        // append-blob may exist; we can't know the URL here, so mark the state
        // so a recruiter understands audio may be partial/absent.
        recording_status: existingDetails.recording_status || "pending",
      };

      const updatePayload: any = {
        is_ended: true,
        details: mergedDetails,
        candidate_status: existingDetails.candidate_status ?? "NO_STATUS",
      };
      if (analytics) {
        updatePayload.is_analysed = true;
        updatePayload.analytics = analytics;
      }

      const { error: updateErr } = await supabase
        .from("response")
        .update(updatePayload)
        .eq("call_id", row.call_id);

      if (updateErr) {
        logger.error(
          `sweep-stale: update failed for ${row.call_id}`,
          updateErr.message,
        );
        continue;
      }

      // Also unlock the assignee's retake — a swept interview never completed
      // properly, so the candidate should be able to try again.
      if (row.email) {
        await supabase
          .from("interview_assignee")
          .update({
            allow_retake: true,
            interview_status: "INTERVIEW_INCOMPLETE",
          })
          .ilike("email", String(row.email))
          .eq("interview_id", row.interview_id);
      }

      swept += 1;
      sweptCallIds.push(row.call_id);
      logger.info(`sweep-stale: finalized overdue interview ${row.call_id}`, {
        age_minutes: Math.round(ageMs / 60000),
        limit_minutes: limitMinutes,
      });
    } catch (err) {
      logger.error(
        `sweep-stale: error processing ${row.call_id}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return NextResponse.json(
    { swept, checked: rows.length, call_ids: sweptCallIds },
    { status: 200 },
  );
}

// Vercel Cron issues a GET and auto-injects `Authorization: Bearer $CRON_SECRET`
// when CRON_SECRET is set in the project env. POST is supported too for manual
// triggering (e.g. curl with the same bearer/secret).
export async function GET(req: NextRequest) {
  return runSweep(req);
}

export async function POST(req: NextRequest) {
  return runSweep(req);
}
