import { logger } from "@/lib/logger";
import { ResponseService } from "@/services/responses.service";
import { NextResponse } from "next/server";
import Retell from "retell-sdk";

const retell = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

export async function POST(req: Request) {
  logger.info("refetch-call request received");
  const body = await req.json();
  const callId = body.id;

  if (!callId) {
    return NextResponse.json(
      { error: "Call ID is required" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get existing response from database
    const existingResponse = await ResponseService.getResponseByCallId(callId);
    
    if (!existingResponse) {
      return NextResponse.json(
        { error: "Response not found in database" },
        { status: 404 }
      );
    }

    // Step 2: Fetch fresh call data from Retell API
    logger.info(`Fetching call data from Retell for call_id: ${callId}`);
    const callOutput = await retell.call.retrieve(callId);
    
    if (!callOutput) {
      return NextResponse.json(
        { error: "Call not found in Retell" },
        { status: 404 }
      );
    }

    // Step 3: Calculate duration
    const duration = (callOutput.end_timestamp && callOutput.start_timestamp)
      ? Math.round(callOutput.end_timestamp / 1000 - callOutput.start_timestamp / 1000)
      : 0;

    // Step 4: Update database with the fetched details
    await ResponseService.updateResponse(
      {
        details: callOutput,
        duration: duration,
      },
      callId
    );

    logger.info(`Successfully refetched and saved call data for: ${callId}`);

    return NextResponse.json(
      {
        success: true,
        message: "Call data refetched and saved successfully",
        callResponse: callOutput,
        duration: duration,
        recording_url: callOutput.recording_url,
        analytics: existingResponse.analytics,
      },
      { status: 200 }
    );
  } catch (error: any) {
    logger.error("Error refetching call:", error instanceof Error ? error.message : String(error));
    
    return NextResponse.json(
      { 
        error: "Failed to refetch call data",
        details: error.message 
      },
      { status: 500 }
    );
  }
}

