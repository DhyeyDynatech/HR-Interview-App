import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const createResponse = async (payload: any) => {
  const { error, data } = await supabase
    .from("response")
    .insert({ ...payload })
    .select("id");

  if (error) {
    console.log(error);


    return [];
  }


  return data[0]?.id;
};

const saveResponse = async (payload: any, call_id: string) => {
  const { error, data } = await supabase
    .from("response")
    .update({ ...payload })
    .eq("call_id", call_id);
  if (error) {
    console.log(error);


    return [];
  }


  return data;
};

const getAllResponses = async (interviewId: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select(`*`)
      .eq("interview_id", interviewId)
      .or(`details.is.null, details->call_analysis.not.is.null`)
      .eq("is_ended", true)
      .order("created_at", { ascending: false });


    return data || [];
  } catch (error) {
    console.log(error);


    return [];
  }
};

const getAllEmails = async (interviewId: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select("email")
      .eq("interview_id", interviewId)
      .not("email", "is", null);

    if (error) {
      console.error("Error fetching emails:", error);

      return [];
    }


    return data || [];
  } catch (error) {
    console.error("Unexpected error fetching emails:", error);

    return [];
  }
};

const getResponseCountByUserId = async (
  userId: string,
): Promise<number> => {
  try {
    // Get all interviews for this user, then count their responses
    const { data: interviews, error: interviewsError } = await supabase
      .from("interview")
      .select("id")
      .eq("user_id", userId);

    if (interviewsError || !interviews) {

      return 0;
    }

    const interviewIds = interviews.map((i) => i.id);
    
    const { count, error } = await supabase
      .from("response")
      .select("*", { count: "exact", head: true })
      .in("interview_id", interviewIds);

    if (error) {
      console.error("Error counting responses:", error);

      return 0;
    }


    return count || 0;
  } catch (error) {
    console.error("Unexpected error counting responses:", error);

    return 0;
  }
};

const getResponseByCallId = async (callId: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select("*")
      .eq("call_id", callId)
      .single();

    if (error) {
      console.error("Error fetching response by call_id:", error);

      return null;
    }


    return data;
  } catch (error) {
    console.error("Unexpected error fetching response by call_id:", error);

    return null;
  }
};

const updateResponse = async (payload: any, call_id: string) => {
  const { error, data } = await supabase
    .from("response")
    .update({ ...payload })
    .eq("call_id", call_id);
  
  if (error) {
    console.error("Error updating response:", error);

    return null;
  }


  return data;
};

const deleteResponse = async (call_id: string) => {
  const { error, data } = await supabase
    .from("response")
    .delete()
    .eq("call_id", call_id);
  
  if (error) {
    console.error("Error deleting response:", error);

    return null;
  }


  return data;
};

const updateCandidateStatusForUser = async (
  interviewId: string,
  email: string,
  newStatus: string,
) => {
  const { error, data } = await supabase
    .from("response")
    .update({ candidate_status: newStatus })
    .eq("interview_id", interviewId)
    .ilike("email", email);

  if (error) {
    console.error("Error updating candidate status for user:", error);

    return null;
  }

  return data;
};

export const ResponseService = {
  createResponse,
  saveResponse,
  getAllResponses,
  getAllEmails,
  getResponseCountByUserId,
  getResponseByCallId,
  updateResponse,
  deleteResponse,
   updateCandidateStatusForUser,
  // Keep old method name for backward compatibility
  getResponseCountByOrganizationId: getResponseCountByUserId,
};
