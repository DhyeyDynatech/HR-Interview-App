import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logger } from "@/lib/logger";
import { InterviewService } from "@/services/interviews.service";
import { logActivityFromRequest, getUserIdFromRequest } from "@/lib/user-activity-log";
import * as UserService from '@/services/users.service';

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

// Power Automate Flow Configuration
const POWER_AUTOMATE_FLOW_URL = process.env.POWER_AUTOMATE_FLOW_URL || 
  "https://8250a9bfeb76ef4cba38b14a0bb011.0c.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/c23211e1facb4777976e1d4443b2dd11/triggers/manual/paths/invoke?api-version=1";

// Power Automate Authentication
// Option 1: OAuth Bearer Token
const POWER_AUTOMATE_ACCESS_TOKEN = process.env.POWER_AUTOMATE_ACCESS_TOKEN;
// Option 2: Shared Access Signature (SAS) - usually added as query parameter or header
const POWER_AUTOMATE_SAS_TOKEN = process.env.POWER_AUTOMATE_SAS_TOKEN;

/**
 * Send email via Power Automate
 * 
 * Required Environment Variables:
 * - POWER_AUTOMATE_FLOW_URL: Your Power Automate flow trigger URL
 * 
 * Optional Authentication (one of the following):
 * - POWER_AUTOMATE_ACCESS_TOKEN: OAuth Bearer token
 * - POWER_AUTOMATE_SAS_TOKEN: Shared Access Signature token
 * 
 * The Power Automate flow expects this JSON structure:
 * {
 *   "emailMeta": {
 *     "to": "recipient@email.com",
 *     "subject": "Email Subject",
 *     "body": "Email body (HTML supported)"
 *   }
 * }
 */
const sendEmailViaPowerAutomate = async (
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const requestBody = {
      emailMeta: {
        to: to,
        subject: subject,
        body: body,
      },
    };

    // Prepare headers
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Add OAuth Bearer token if provided
    if (POWER_AUTOMATE_ACCESS_TOKEN) {
      headers["Authorization"] = `Bearer ${POWER_AUTOMATE_ACCESS_TOKEN}`;
    }

    // Build URL - check if SAS token is already in URL or needs to be added
    let flowUrl = POWER_AUTOMATE_FLOW_URL;
    
    // If SAS token is provided separately and not already in URL, add it
    if (POWER_AUTOMATE_SAS_TOKEN && !flowUrl.includes("sig=")) {
      // Add SAS token as query parameter
      const separator = flowUrl.includes("?") ? "&" : "?";
      // Extract just the sig value if full SAS token string is provided
      let sigValue = POWER_AUTOMATE_SAS_TOKEN;
      if (POWER_AUTOMATE_SAS_TOKEN.includes("sig=")) {
        const match = POWER_AUTOMATE_SAS_TOKEN.match(/sig=([^&]+)/);
        sigValue = match ? match[1] : POWER_AUTOMATE_SAS_TOKEN;
      }
      flowUrl = `${flowUrl}${separator}sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=${encodeURIComponent(sigValue)}`;
    }

    // Also try adding SAS token as header (some flows may require this)
    if (POWER_AUTOMATE_SAS_TOKEN && !POWER_AUTOMATE_ACCESS_TOKEN) {
      let sigValue = POWER_AUTOMATE_SAS_TOKEN;
      if (POWER_AUTOMATE_SAS_TOKEN.includes("sig=")) {
        const match = POWER_AUTOMATE_SAS_TOKEN.match(/sig=([^&]+)/);
        sigValue = match ? match[1] : POWER_AUTOMATE_SAS_TOKEN;
      }
      headers["x-ms-workflow-sas"] = sigValue;
    }

    const response = await fetch(flowUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Power Automate API error: ${response.status} - ${errorText}`);

      return {
        success: false,
        error: `Power Automate API returned ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json().catch(() => ({}));
    logger.info(`Email sent via Power Automate to ${to}`);


    return {
      success: true,
      messageId: result?.messageId || `powerautomate-${Date.now()}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error calling Power Automate:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
};

interface AssigneeEmailData {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  interview_id: string;
}

export async function POST(req: NextRequest) {
  try {
    logger.info("send-assignee-emails request received");
    const body = await req.json();
    const { assignees } = body;

    if (!assignees || !Array.isArray(assignees) || assignees.length === 0) {

      return NextResponse.json(
        { error: "Assignees array is required" },
        { status: 400 }
      );
    }

    // Validate Power Automate configuration
    if (!POWER_AUTOMATE_FLOW_URL) {

      return NextResponse.json(
        { 
          error: "Power Automate configuration error",
          message: "POWER_AUTOMATE_FLOW_URL environment variable is not set"
        },
        { status: 500 }
      );
    }

    // Warn if no authentication is configured (but don't fail, as flow might allow anonymous access)
    if (!POWER_AUTOMATE_ACCESS_TOKEN && !POWER_AUTOMATE_SAS_TOKEN) {
      logger.warn("No Power Automate authentication token set. The flow may require authentication (OAuth or Shared Access Signature).");
    }

    const results = [];
    const protocol = base_url?.includes("localhost") ? "http" : "https";

    for (const assignee of assignees as AssigneeEmailData[]) {
      try {
        if (!assignee.email || !assignee.interview_id) {
          results.push({
            assignee_id: assignee.id,
            email: assignee.email,
            success: false,
            error: "Missing email or interview_id",
          });
          continue;
        }

        // Get interview details
        const interview = await InterviewService.getInterviewById(assignee.interview_id);
        
        if (!interview) {
          results.push({
            assignee_id: assignee.id,
            email: assignee.email,
            success: false,
            error: "Interview not found",
          });
          continue;
        }

        // Generate interview link
        const interviewLink = interview.readable_slug
          ? `${protocol}://${base_url}/call/${interview.readable_slug}`
          : interview.url || `${protocol}://${base_url}/call/${assignee.interview_id}`;

        // Email content
        const emailSubject = `Interview Invitation: ${interview.name}`;
        const emailBodyHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
    <h2 style="color: #4F46E5; margin-top: 0;">Interview Invitation</h2>
  </div>
  
  <p>Dear ${assignee.first_name} ${assignee.last_name},</p>
  
  <p>You have been invited to participate in an interview.</p>
  
  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h3 style="color: #1f2937; margin-top: 0;">Interview Details</h3>
    <p><strong>Interview Name:</strong> ${interview.name}</p>
    ${interview.description ? `<p><strong>Description:</strong> ${interview.description}</p>` : ''}
    ${interview.time_duration ? `<p><strong>Duration:</strong> ${interview.time_duration} minutes</p>` : ''}
  </div>
  
  <div style="text-align: center; margin: 30px 0;">
    <a href="${interviewLink}" 
       style="display: inline-block; background-color: #4F46E5; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
      Start Interview
    </a>
  </div>
  
  <p style="color: #6b7280; font-size: 14px;">
    Or copy and paste this link into your browser:<br>
    <a href="${interviewLink}" style="color: #4F46E5; word-break: break-all;">${interviewLink}</a>
  </p>
  
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  
  <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
    Best regards,<br>
    Interview Team
  </p>
</body>
</html>
        `.trim();

        const emailBodyText = `
Dear ${assignee.first_name} ${assignee.last_name},

You have been invited to participate in an interview.

Interview Details:
- Interview Name: ${interview.name}
${interview.description ? `- Description: ${interview.description}` : ''}
${interview.time_duration ? `- Duration: ${interview.time_duration} minutes` : ''}

Please click on the link below to start your interview:
${interviewLink}

Best regards,
Interview Team
        `.trim();

        // Send email using Power Automate
        const emailResult = await sendEmailViaPowerAutomate(
          assignee.email,
          emailSubject,
          emailBodyHTML
        );

        if (emailResult.success) {
          logger.info(`Email sent successfully to ${assignee.email} via Power Automate:`, {
            messageId: emailResult.messageId,
            subject: emailSubject,
            interviewLink,
          });

          // Update interview_status - check if it's a resend
          try {
            const { assigneeService } = await import('@/services/users.service');
            const { ResponseService } = await import('@/services/responses.service');

            // Get current assignee to check existing status
            const currentAssignee = await assigneeService.getAssigneeById(assignee.id);

            // Check if this assignee already has any completed response for this interview
            // If yes, it means they already interacted with the interview previously
            const existingResponses = await ResponseService.getAllResponses(interview.id);
            const hasResponsesForAssignee = existingResponses.some(
              (r: any) =>
                r.email &&
                r.email.toLowerCase() === assignee.email.toLowerCase()
            );

            // Rules:
            // - First ever send (status NOT_SENT or null, no responses) -> INTERVIEW_SENT
            // - Re-sending before candidate ever takes interview (no responses) -> still INTERVIEW_SENT
            // - Re-sending after candidate has at least one response -> INTERVIEW_RESENT
            let newStatus: 'INTERVIEW_SENT' | 'INTERVIEW_RESENT' = 'INTERVIEW_SENT';

            if (hasResponsesForAssignee) {
              newStatus = 'INTERVIEW_RESENT';
            }

            await assigneeService.updateAssignee(assignee.id, {
              interview_status: newStatus,
            } as any);
            
            logger.info(`Updated interview_status to ${newStatus} for assignee ${assignee.id}`);
          } catch (updateError) {
            const errorMessage = updateError instanceof Error ? updateError.message : String(updateError);
            logger.error(`Failed to update interview_status for assignee ${assignee.id}:`, errorMessage);
            // Don't fail the email send if status update fails
          }

          results.push({
            assignee_id: assignee.id,
            email: assignee.email,
            success: true,
            interviewLink,
            messageId: emailResult.messageId,
          });
        } else {
          logger.error(`Failed to send email to ${assignee.email} via Power Automate:`, emailResult.error);
          results.push({
            assignee_id: assignee.id,
            email: assignee.email,
            success: false,
            error: emailResult.error || "Email sending failed",
          });
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error sending email to ${assignee.email}:`, errorMessage);
        results.push({
          assignee_id: assignee.id,
          email: assignee.email,
          success: false,
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info(`Email sending completed: ${successCount} successful, ${failureCount} failed`);

    // Log bulk email sending activity
    try {
      // Try Bearer token authentication first (used by the app)
      const authHeader = req.headers.get("authorization");
      let userId: string | null = null;
      
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const { verifyToken } = await import('@/lib/auth');
        const token = authHeader.substring(7);
        const { valid, userId: tokenUserId } = verifyToken(token);
        if (valid && tokenUserId) {
          userId = tokenUserId;
        }
      }
      
      // If Bearer token not found, try getUserIdFromRequest (cookies)
      if (!userId) {
        userId = await getUserIdFromRequest(req);
      }
      
      // If still not found, try Supabase auth cookies
      if (!userId) {
        try {
          const cookieStore = cookies();
          const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
              cookies: {
                get(name: string) {
                  return cookieStore.get(name)?.value;
                },
              },
            }
          );
          
          const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
          if (!authError && authUser) {
            // Map Supabase auth user ID to user table ID
            const currentUser = await UserService.getUserById(authUser.id);
            userId = currentUser?.id || authUser.id;
          }
        } catch (error) {
          console.error("Error with Supabase auth:", error);
        }
      }
      
      // Get unique interview IDs from assignees
      const interviewIds = Array.from(new Set(assignees.map((a: AssigneeEmailData) => a.interview_id).filter(Boolean)));
      
      // Build assignee details array with information about who received emails
      const assigneeDetails = results.map((result) => {
        const assignee = assignees.find((a: AssigneeEmailData) => a.id === result.assignee_id);
        return {
          assignee_id: result.assignee_id,
          assignee_email: result.email,
          assignee_name: assignee ? `${assignee.first_name} ${assignee.last_name}` : null,
          interview_id: assignee?.interview_id || null,
          success: result.success,
          error: result.error || null,
          message_id: result.messageId || null,
        };
      });
      
      await logActivityFromRequest(
        req,
        "bulk_emails_sent",
        {
          user_id: userId,
          resource_type: "assignee",
          resource_id: interviewIds.length === 1 ? interviewIds[0] : null,
          details: {
            interview_ids: interviewIds,
            total_emails: assignees.length,
            success_count: successCount,
            failure_count: failureCount,
            email_timestamp: new Date().toISOString(),
            assignees: assigneeDetails, // List of assignees who received emails
            successful_assignees: assigneeDetails.filter(a => a.success).map(a => ({
              assignee_id: a.assignee_id,
              assignee_email: a.assignee_email,
              assignee_name: a.assignee_name,
            })),
            failed_assignees: assigneeDetails.filter(a => !a.success).map(a => ({
              assignee_id: a.assignee_id,
              assignee_email: a.assignee_email,
              assignee_name: a.assignee_name,
              error: a.error,
            })),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log bulk email sending activity:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(
      {
        success: true,
        message: `Emails processed: ${successCount} successful, ${failureCount} failed`,
        results,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error in send-assignee-emails:", errorMessage);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

