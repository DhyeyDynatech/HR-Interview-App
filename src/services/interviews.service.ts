import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getAllInterviews = async (userId: string, userRole?: string) => {
  try {
    let query = supabase
      .from("interview")
      .select(`*`);

    // If user is admin, show all interviews. Otherwise, show only their own
    if (userRole === 'admin') {
      // Admin can see all interviews - no filter
    } else {
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
    const { data, error } = await supabase
      .from("interview")
      .select(`*`)
      .or(`id.eq.${id},readable_slug.eq.${id}`);


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
    // Server context - use direct Supabase call (API route will handle logging)
    const { error, data } = await supabase
      .from("interview")
      .update({ ...payload })
      .eq("id", id);
    if (error) {
      console.log(error);
      return [];
    }
    return data;
  }
};

const deleteInterview = async (id: string) => {
  const { error, data } = await supabase
    .from("interview")
    .delete()
    .eq("id", id);
  if (error) {
    console.log(error);


    return [];
  }


  return data;
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
  // Remove organization_id from payload if it exists
  const { organization_id, ...interviewPayload } = payload;
  
  const { error, data } = await supabase
    .from("interview")
    .insert({ ...interviewPayload });
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
  getAllRespondents,
  createInterview,
  deactivateInterviewsByOrgId: deactivateInterviewsByUserId, // Keep for backward compatibility
};
