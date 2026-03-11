import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import Retell from "retell-sdk";

// Force dynamic rendering - this route uses request search params
export const dynamic = "force-dynamic";

// Create Retell client lazily to ensure env vars are available in serverless
function getRetellClient() {
  return new Retell({
    apiKey: process.env.RETELL_API_KEY || "",
  });
}

export async function GET(req: NextRequest) {
  const retellClient = getRetellClient();

  try {
    const agentId = req.nextUrl.searchParams.get("agent_id");

    if (!agentId) {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 }
      );
    }

    // Step 1: Fetch agent details from Retell to get the voice_id
    let agentDetails;
    try {
      agentDetails = await retellClient.agent.retrieve(agentId);
      logger.info(`Retrieved agent details for ${agentId}`, {
        voice_id: agentDetails?.voice_id,
        agent_name: agentDetails?.agent_name
      });
    } catch (agentError) {
      logger.warn(`Failed to retrieve agent ${agentId}`, {
        error: agentError instanceof Error ? agentError.message : String(agentError)
      });
      return NextResponse.json(
        {
          error: "Could not retrieve agent details",
          message: agentError instanceof Error ? agentError.message : String(agentError)
        },
        { status: 404 }
      );
    }

    if (!agentDetails) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    // Step 2: Get voice details using the voice_id from the agent
    const voiceId = agentDetails.voice_id;

    if (!voiceId) {
      logger.warn(`Agent ${agentId} has no voice_id configured`);
      return NextResponse.json(
        {
          agent_id: agentId,
          voice_id: null,
          voice_name: null,
          language: null,
          voice_preview_url: null,
        },
        { status: 200 }
      );
    }

    // Step 3: Fetch voice details to get the preview URL
    let voiceDetails;
    try {
      voiceDetails = await retellClient.voice.retrieve(voiceId);
      logger.info(`Retrieved voice details for ${voiceId}`, {
        voice_name: voiceDetails?.voice_name,
        provider: voiceDetails?.provider,
        preview_audio_url: voiceDetails?.preview_audio_url
      });
    } catch (voiceError) {
      logger.warn(`Failed to retrieve voice ${voiceId}`, {
        error: voiceError instanceof Error ? voiceError.message : String(voiceError)
      });
      // Return partial info if voice details fetch fails
      return NextResponse.json(
        {
          agent_id: agentId,
          voice_id: voiceId,
          voice_name: null,
          language: null,
          voice_preview_url: null,
        },
        { status: 200 }
      );
    }

    // Build the response with agent and voice information
    const agentDetailsAny = agentDetails as any;
    const responseData = {
      // Agent details
      agent_id: agentId,
      agent_name: agentDetails.agent_name || null,
      begin_message: agentDetailsAny.begin_message || null,
      // Voice details
      voice_id: voiceId,
      voice_name: voiceDetails?.voice_name || null,
      language: voiceDetails?.accent || null,
      voice_preview_url: voiceDetails?.preview_audio_url || null,
      provider: voiceDetails?.provider || null,
      gender: voiceDetails?.gender || null,
      age: voiceDetails?.age || null,
    };

    logger.info(`Retrieved agent and voice info for ${agentId}`, responseData);

    return NextResponse.json(responseData, { status: 200 });
  } catch (error) {
    logger.error("Error fetching agent voice:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

