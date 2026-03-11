import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Retell from "retell-sdk";

// Force dynamic rendering - this route uses request params and body
export const dynamic = "force-dynamic";

// Create clients lazily to ensure env vars are available in serverless
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, supabaseKey);
}

function getRetellClient() {
  return new Retell({
    apiKey: process.env.RETELL_API_KEY || "",
  });
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    const searchParams = req.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");

    // 1. Get all responses with their interview data
    const { data: responses, error: responsesError } = await supabase
      .from("response")
      .select(`
        id,
        created_at,
        interview_id,
        name,
        email,
        call_id,
        is_ended,
        is_analysed,
        duration,
        interview:interview_id (
          id,
          name,
          organization_id,
          user_id
        )
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (responsesError) {
      return NextResponse.json({ error: responsesError.message }, { status: 500 });
    }

    // 2. Analyze each response for issues
    const analysis = (responses || []).map((r: any) => {
      const issues: string[] = [];

      if (!r.is_ended) issues.push("is_ended is false");
      if (r.duration === null || r.duration === undefined) issues.push("duration is NULL");
      if (!r.interview) issues.push("No linked interview found");
      if (r.interview && !r.interview.organization_id) issues.push("Interview has no organization_id");
      if (organizationId && r.interview?.organization_id !== organizationId) {
        issues.push(`organization_id mismatch (interview: ${r.interview?.organization_id}, user: ${organizationId})`);
      }

      return {
        id: r.id,
        candidate: r.name || "Unknown",
        email: r.email,
        call_id: r.call_id,
        is_ended: r.is_ended,
        is_analysed: r.is_analysed,
        duration: r.duration,
        interview_name: r.interview?.name || "Unknown",
        interview_organization_id: r.interview?.organization_id,
        created_at: r.created_at,
        issues: issues.length > 0 ? issues : ["OK - Should appear in cost analysis"],
        canFix: issues.includes("duration is NULL") && r.call_id && r.is_ended,
      };
    });

    // 3. Get all users and their organization info
    const { data: allUsers } = await supabase
      .from("user")
      .select("id, email, organization_id")
      .limit(10);

    // 4. Get all interviews to show their organization_id status
    const { data: allInterviews } = await supabase
      .from("interview")
      .select("id, name, organization_id, user_id")
      .order("created_at", { ascending: false })
      .limit(20);

    // 5. Get all organizations
    const { data: allOrganizations } = await supabase
      .from("organization")
      .select("id, name")
      .limit(10);

    // 6. Summary
    const summary = {
      totalResponses: analysis.length,
      withIssues: analysis.filter((a: any) => !a.issues.includes("OK - Should appear in cost analysis")).length,
      missingDuration: analysis.filter((a: any) => a.duration === null).length,
      notEnded: analysis.filter((a: any) => !a.is_ended).length,
      fixable: analysis.filter((a: any) => a.canFix).length,
    };

    return NextResponse.json({
      summary,
      responses: analysis,
      users: allUsers,
      interviews: allInterviews,
      organizations: allOrganizations,
      queryOrganizationId: organizationId,
    }, { status: 200 });

  } catch (error) {
    console.error("Diagnose error:", error);
    return NextResponse.json({ error: "Failed to diagnose" }, { status: 500 });
  }
}

// POST endpoint to fix missing durations
export async function POST(req: NextRequest) {
  const supabase = getSupabaseClient();
  const retell = getRetellClient();

  try {
    const body = await req.json();
    const { action, callId } = body;

    if (action === "fix_duration" && callId) {
      // Fetch call details from Retell
      try {
        const callOutput = await retell.call.retrieve(callId);
        const duration = (callOutput.end_timestamp && callOutput.start_timestamp)
          ? Math.round(callOutput.end_timestamp / 1000 - callOutput.start_timestamp / 1000)
          : 0;

        // Update the response with duration
        const { error: updateError } = await supabase
          .from("response")
          .update({
            duration: duration,
            is_ended: true,
            details: callOutput
          })
          .eq("call_id", callId);

        if (updateError) {
          return NextResponse.json({
            success: false,
            error: updateError.message
          }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          message: `Fixed! Duration set to ${duration} seconds (${(duration / 60).toFixed(1)} minutes)`,
          duration,
        }, { status: 200 });

      } catch (retellError: any) {
        return NextResponse.json({
          success: false,
          error: `Retell API error: ${retellError.message}`,
        }, { status: 500 });
      }
    }

    if (action === "fix_all") {
      // Get all responses with missing duration that have call_id
      const { data: responses, error } = await supabase
        .from("response")
        .select("id, call_id")
        .is("duration", null)
        .not("call_id", "is", null)
        .eq("is_ended", true);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const results = [];
      for (const response of responses || []) {
        try {
          const callOutput = await retell.call.retrieve(response.call_id);
          const duration = (callOutput.end_timestamp && callOutput.start_timestamp)
            ? Math.round(callOutput.end_timestamp / 1000 - callOutput.start_timestamp / 1000)
            : 0;

          await supabase
            .from("response")
            .update({ duration, details: callOutput })
            .eq("call_id", response.call_id);

          results.push({ id: response.id, call_id: response.call_id, duration, status: "fixed" });
        } catch (e: any) {
          results.push({ id: response.id, call_id: response.call_id, status: "error", error: e.message });
        }
      }

      return NextResponse.json({
        success: true,
        message: `Processed ${results.length} responses`,
        results,
      }, { status: 200 });
    }

    // Fix organization_id on interviews
    if (action === "fix_organization_id") {
      const { organizationId: orgId } = body;

      if (!orgId) {
        return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
      }

      // Update all interviews that have null organization_id
      const { data: updatedInterviews, error: updateError } = await supabase
        .from("interview")
        .update({ organization_id: orgId })
        .is("organization_id", null)
        .select("id, name");

      if (updateError) {
        return NextResponse.json({
          success: false,
          error: updateError.message
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Updated ${updatedInterviews?.length || 0} interviews with organization_id: ${orgId}`,
        updatedInterviews,
      }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("Fix error:", error);
    return NextResponse.json({ error: "Failed to fix" }, { status: 500 });
  }
}
