import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { Retell } from "retell-sdk";

const apiKey = process.env.RETELL_API_KEY || "";

export async function POST(req: NextRequest, res: NextResponse) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const signature = req.headers.get("x-retell-signature");
  if (!signature) {
    console.error("Missing signature");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // Parse request body
  const body = await req.json();
  const bodyString = JSON.stringify(body);

  if (
    !Retell.verify(
      bodyString,
      apiKey,
      signature,
    )
  ) {
    console.error("Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { event, call } = body as { event: string; call: any };

  switch (event) {
    case "call_started":
      console.log("Call started event received", call.call_id);
      break;
    case "call_ended":
      console.log("Call ended event received", call.call_id);
      break;
    case "call_analyzed":
      const result = await axios.post("/api/get-call", {
        id: call.call_id,
      });
      console.log("Call analyzed event received", call.call_id);
      
      // Update interview_status to AI_RESPONSE_CAPTURED
      try {
        const { ResponseService } = await import("@/services/responses.service");
        const { assigneeService } = await import("@/services/users.service");
        
        const response = await ResponseService.getResponseByCallId(call.call_id);
        if (response && response.interview_id && response.email) {
          const assignee = await assigneeService.getAssigneeByEmailAndInterview(
            response.email.toLowerCase(),
            response.interview_id
          );
          
          if (assignee && assignee.id) {
            await assigneeService.updateAssignee(assignee.id, {
              interview_status: 'AI_RESPONSE_CAPTURED',
            } as any);
            console.log(`Updated interview_status to AI_RESPONSE_CAPTURED for assignee ${assignee.id}`);
          }
        }
      } catch (error) {
        console.error("Error updating interview_status to AI_RESPONSE_CAPTURED:", error);
        // Don't fail the webhook if status update fails
      }
      break;
    default:
      console.log("Received an unknown event:", event);
  }

  // Acknowledge the receipt of the event

  return NextResponse.json({ status: 204 });
}
