import { createBrowserClient } from "@supabase/ssr";
import Retell from "retell-sdk";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const retellClient = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

const getAllInterviewers = async (clientId: string = "") => {
  try {
    const { data: clientData, error: clientError } = await supabase
      .from("interviewer")
      .select(`*`);

    if (clientError) {
      console.error(
        `Error fetching interviewers for clientId ${clientId}:`,
        clientError,
      );


      return [];
    }


    return clientData || [];
  } catch (error) {
    console.log(error);


    return [];
  }
};

const createInterviewer = async (payload: any) => {
  // Check for existing interviewer with the same name
  const { data: existingInterviewer, error: checkError } = await supabase
    .from("interviewer")
    .select("*")
    .eq("name", payload.name)
    .filter("agent_id", "eq", payload.agent_id)
    .single();

  if (checkError && checkError.code !== "PGRST116") {
    console.error("Error checking existing interviewer:", checkError);


    return null;
  }

  if (existingInterviewer) {
    console.error("An interviewer with this name already exists");


    return null;
  }

  const { error, data } = await supabase
    .from("interviewer")
    .insert({ ...payload });

  if (error) {
    console.error("Error creating interviewer:", error);


    return null;
  }


  return data;
};

const getInterviewer = async (interviewerId: bigint) => {
  const { data: interviewerData, error: interviewerError } = await supabase
    .from("interviewer")
    .select("*")
    .eq("id", interviewerId)
    .single();

  if (interviewerError) {
    console.error("Error fetching interviewer:", interviewerError);


    return null;
  }


  return interviewerData;
};

const getInterviewerByAgentId = async (agentId: string) => {
  try {
    const { data: interviewerData, error: interviewerError } = await supabase
      .from("interviewer")
      .select("*")
      .eq("agent_id", agentId)
      .single();

    if (interviewerError) {
      console.error("Error fetching interviewer by agent_id:", interviewerError);
      return null;
    }

    return interviewerData;
  } catch (error) {
    console.error("Error in getInterviewerByAgentId:", error);
    return null;
  }
};

const getRetellAgentDetails = async (agentId: string) => {
  try {
    if (!process.env.RETELL_API_KEY) {
      console.error("RETELL_API_KEY is not configured");
      return null;
    }

    const agentDetails = await retellClient.agent.retrieve(agentId);
    return agentDetails;
  } catch (error) {
    console.error("Error fetching Retell agent details:", error);
    return null;
  }
};

export const InterviewerService = {
  getAllInterviewers,
  createInterviewer,
  getInterviewer,
  getInterviewerByAgentId,
  getRetellAgentDetails,
};
