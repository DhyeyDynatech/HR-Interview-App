import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server-side (API-route) client. Uses the service-role key to bypass RLS —
// required for writes/deletes to actually persist — with a fresh client per
// call and cache: 'no-store' to avoid stale Vercel serverless connections.
// Mirrors the pattern in src/lib/auth.ts getSupabaseClient().
const getServerClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, key, {
    global: {
      fetch: (input: any, init: any = {}) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
};

const getAllInterviews = async (userId: string, userRole?: string, organizationId?: string | null) => {
  try {
    let query = supabase
      .from("interview")
      .select(`*`);

    if (organizationId) {
      // All users in the same org see the same interviews
      query = query.eq("organization_id", organizationId);
    } else {
      // Fallback for accounts without an org: show only their own interviews
      query = query.eq("user_id", userId);
    }

    const { data: clientData, error: clientError } = await query
      .order("created_at", { ascending: false });


    return [...(clientData || [])];
  } catch (error) {
    console.log(error);


    return [];
  }
};

const getInterviewById = async (id: string) => {
  try {
    // Double-quote the value: PostgREST's or= grammar treats commas as term
    // separators and parentheses as logic-group delimiters, so an unquoted slug
    // like "power-platform-developer-(power-apps)" fails to parse (PGRST100).
    const safeId = `"${id.replace(/"/g, '\\"')}"`;

    const { data, error } = await supabase
      .from("interview")
      .select(`*`)
      .or(`id.eq.${safeId},readable_slug.eq.${safeId}`);


    return data ? data[0] : null;
  } catch (error) {
    console.log(error);


    return [];
  }
};

const updateInterview = async (payload: any, id: string) => {
  // If running in browser, call API endpoint (for logging)
  // If running in server (API route), use direct Supabase call
  if (typeof window !== 'undefined') {
    // Browser context - call API endpoint for logging
    try {
      const token = localStorage.getItem('auth_token');
      const baseUrl = window.location.origin;
      
      const response = await fetch(`${baseUrl}/api/interviews/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.interview || result;
    } catch (error) {
      console.error('Error updating interview:', error);
      throw error;
    }
  } else {
    // Server context - use the service-role client so RLS doesn't silently
    // block the write. .select() lets us confirm a row was actually updated,
    // and we throw on failure so the API route returns a real error instead of
    // a false success.
    const serverClient = getServerClient();
    const { error, data } = await serverClient
      .from("interview")
      .update({ ...payload })
      .eq("id", id)
      .select();
    if (error) {
      console.error("Failed to update interview:", error);
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      throw new Error(`Update affected no rows for interview ${id}`);
    }

    return data;
  }
};

const deleteInterview = async (id: string) => {
  if (typeof window !== "undefined") {
    // Browser context — call API route so ownership check is enforced
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`${window.location.origin}/api/interviews/${id}`, {
      method: "DELETE",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  // Server context — service-role client so RLS doesn't silently block the
  // delete.
  const serverClient = getServerClient();

  // feedback has a FK to interview(id) but no recruiter-facing UI to manage it,
  // so remove the interview's feedback rows here before deleting the interview.
  // (The other FK tables — interview_assignee, response — are blocked upstream
  // in the DELETE route via getInterviewDeletionBlockers.)
  const { error: feedbackError } = await serverClient
    .from("feedback")
    .delete()
    .eq("interview_id", id);
  if (feedbackError) {
    console.error("Failed to delete interview feedback:", feedbackError);
    throw new Error(feedbackError.message);
  }

  // .select() returns the deleted rows so we can confirm one was actually
  // removed, and we throw on failure so the API route surfaces a real error
  // instead of a false success.
  const { error, data } = await serverClient
    .from("interview")
    .delete()
    .eq("id", id)
    .select();
  if (error) {
    console.error("Failed to delete interview:", error);
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(`Delete affected no rows for interview ${id}`);
  }

  return data;
};

// Server-side only. Counts the records that should BLOCK an interview deletion.
// These are the ones a recruiter can see and manage in the UI: assigned
// candidates, responses, and ATS scoring jobs. interview_assignee / response
// have real FKs to interview(id) (see DB setup/complete_database_setup.sql);
// ats_job_data has NO FK and is blocked purely as a product policy choice.
// NOTE: feedback also has a FK but has NO recruiter-facing UI, so it is NOT a
// blocker — it is auto-deleted in deleteInterview instead. Uses the service-role
// client so RLS doesn't skew the counts.
const getInterviewDeletionBlockers = async (id: string) => {
  const serverClient = getServerClient();
  const [assignees, responses, atsJobs] = await Promise.all([
    serverClient
      .from("interview_assignee")
      .select("id", { count: "exact", head: true })
      .eq("interview_id", id),
    serverClient
      .from("response")
      .select("id", { count: "exact", head: true })
      .eq("interview_id", id),
    serverClient
      .from("ats_job_data")
      .select("interview_id", { count: "exact", head: true })
      .eq("interview_id", id),
  ]);

  if (assignees.error) {
    throw new Error(assignees.error.message);
  }
  if (responses.error) {
    throw new Error(responses.error.message);
  }
  if (atsJobs.error) {
    throw new Error(atsJobs.error.message);
  }

  return {
    assigneeCount: assignees.count ?? 0,
    responseCount: responses.count ?? 0,
    atsCount: atsJobs.count ?? 0,
  };
};

const getAllRespondents = async (interviewId: string) => {
  try {
    const { data, error } = await supabase
      .from("interview")
      .select(`respondents`)
      .eq("interview_id", interviewId);


    return data || [];
  } catch (error) {
    console.log(error);


    return [];
  }
};

const createInterview = async (payload: any) => {
  const { error, data } = await supabase
    .from("interview")
    .insert({ ...payload });
  if (error) {
    console.log(error);


    return [];
  }


  return data;
};

const deactivateInterviewsByUserId = async (userId: string) => {
  try {
    const { error } = await supabase
      .from("interview")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      console.error("Failed to deactivate interviews:", error);
    }
  } catch (error) {
    console.error("Unexpected error disabling interviews:", error);
  }
};

export const InterviewService = {
  getAllInterviews,
  getInterviewById,
  updateInterview,
  deleteInterview,
  getInterviewDeletionBlockers,
  getAllRespondents,
  createInterview,
  deactivateInterviewsByOrgId: deactivateInterviewsByUserId, // Keep for backward compatibility
};
