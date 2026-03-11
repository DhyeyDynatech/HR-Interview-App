import { logger } from "@/lib/logger";
import { InterviewerService } from "@/services/interviewers.service";
import { NextResponse, NextRequest } from "next/server";
import Retell from "retell-sdk";
import { INTERVIEWERS, RETELL_AGENT_GENERAL_PROMPT } from "@/lib/constants";

export const dynamic = "force-dynamic";

const retellClient = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

export async function GET(res: NextRequest) {
  logger.warn("create-interviewer endpoint called but is disabled - creation not allowed");

  return NextResponse.json(
    { error: "Interviewer creation is disabled. Only default interviewers are allowed." },
    { status: 403 },
  );
}
