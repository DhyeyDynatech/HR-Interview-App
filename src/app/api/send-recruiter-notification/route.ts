import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { assigneeService } from "@/services/users.service";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import Retell from "retell-sdk";

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

// Force dynamic rendering - this route uses request body
export const dynamic = "force-dynamic";

// Create Retell client lazily to ensure env vars are available in serverless
function getRetellClient() {
  return new Retell({
    apiKey: process.env.RETELL_API_KEY || "",
  });
}

// Power Automate Flow Configuration
const POWER_AUTOMATE_FLOW_URL = process.env.POWER_AUTOMATE_FLOW_URL || 
  "https://8250a9bfeb76ef4cba38b14a0bb011.0c.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/c23211e1facb4777976e1d4443b2dd11/triggers/manual/paths/invoke?api-version=1";

const POWER_AUTOMATE_ACCESS_TOKEN = process.env.POWER_AUTOMATE_ACCESS_TOKEN;
const POWER_AUTOMATE_SAS_TOKEN = process.env.POWER_AUTOMATE_SAS_TOKEN;

/**
 * Send email via Power Automate
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

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (POWER_AUTOMATE_ACCESS_TOKEN) {
      headers["Authorization"] = `Bearer ${POWER_AUTOMATE_ACCESS_TOKEN}`;
    }

    let flowUrl = POWER_AUTOMATE_FLOW_URL;
    
    if (POWER_AUTOMATE_SAS_TOKEN && !flowUrl.includes("sig=")) {
      const separator = flowUrl.includes("?") ? "&" : "?";
      let sigValue = POWER_AUTOMATE_SAS_TOKEN;
      if (POWER_AUTOMATE_SAS_TOKEN.includes("sig=")) {
        const match = POWER_AUTOMATE_SAS_TOKEN.match(/sig=([^&]+)/);
        sigValue = match ? match[1] : POWER_AUTOMATE_SAS_TOKEN;
      }
      flowUrl = `${flowUrl}${separator}sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=${encodeURIComponent(sigValue)}`;
    }

    if (POWER_AUTOMATE_SAS_TOKEN) {
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

export async function POST(req: NextRequest) {
  try {
    logger.info("send-recruiter-notification request received");
    const body = await req.json();
    const { callId, assigneeEmail } = body;

    if (!callId || !assigneeEmail) {
      return NextResponse.json(
        { error: "Call ID and assignee email are required" },
        { status: 400 }
      );
    }

    // Get response/interview data
    const response = await ResponseService.getResponseByCallId(callId);
    if (!response) {
      return NextResponse.json(
        { error: "Response not found" },
        { status: 404 }
      );
    }

    // Get interview details
    const interview = await InterviewService.getInterviewById(response.interview_id);
    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    // Get assignee details
    const assignee = await assigneeService.getAssigneeByEmailAndInterview(
      assigneeEmail,
      response.interview_id
    );

    if (!assignee) {
      return NextResponse.json(
        { error: "Assignee not found" },
        { status: 404 }
      );
    }

    // Fixed recruiter email configuration
    const FIXED_RECRUITER_EMAIL = process.env.FIXED_RECRUITER_EMAIL;
    if (!FIXED_RECRUITER_EMAIL) {
      logger.error("FIXED_RECRUITER_EMAIL environment variable is not set");

      return NextResponse.json(
        { error: "Recruiter email configuration missing" },
        { status: 500 }
      );
    }
    const recruiterName = "Dynatech";

    // Check if analytics exist, if not generate them
    let analytics = response.analytics || {};
    
    if (!response.is_analysed || !analytics.overallScore) {
      logger.info(`Analytics not found for call ${callId}, generating now...`);
      
      try {
        // Retrieve call details from Retell
        const retell = getRetellClient();
        const callOutput = await retell.call.retrieve(callId);
        const transcript = callOutput.transcript;
        
        if (!transcript) {
          logger.warn(`Transcript not available for call ${callId}, analytics cannot be generated`);
        } else {
          // Generate analytics
          const analyticsResult = await generateInterviewAnalytics({
            callId: callId,
            interviewId: response.interview_id,
            transcript: transcript,
          });
          
          if (analyticsResult.analytics) {
            analytics = analyticsResult.analytics;
            
            // Update response with generated analytics
            await ResponseService.saveResponse(
              {
                is_analysed: true,
                analytics: analytics,
              },
              callId,
            );
            
            logger.info(`Analytics generated successfully for call ${callId}`);
          } else {
            logger.error(`Failed to generate analytics for call ${callId}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error generating analytics for call ${callId}:`, errorMessage);
        // Continue with empty analytics rather than failing the email
      }
    }

    // Calculate interview metrics
    // Communication score is on 0-10 scale, convert to 0-100 percentage
    const overallScore = analytics.overallScore || 0;
    const communicationScoreRaw = analytics.communication?.score || 0;
    // Convert from 0-10 scale to 0-100 percentage
    const communicationScore = typeof communicationScoreRaw === 'number' 
      ? Math.round(communicationScoreRaw * 10) 
      : 0;
    const duration = response.duration || 0;
    const durationMinutes = Math.floor(duration / 60);
    const durationSeconds = duration % 60;
    
    // Violation counts
    const tabSwitchCount = response.tab_switch_count || 0;
    const faceMismatchCount = response.face_mismatch_count || 0;
    const cameraOffCount = response.camera_off_count || 0;
    const multiplePersonCount = response.multiple_person_count || 0;
    const totalViolations = tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount;

    // Determine status badge
    const getStatusBadge = () => {
      if (totalViolations === 0 && overallScore >= 70) {
        return { text: "Excellent", color: "#10b981", bgColor: "#d1fae5" };
      } else if (totalViolations <= 2 && overallScore >= 60) {
        return { text: "Good", color: "#3b82f6", bgColor: "#dbeafe" };
      } else if (totalViolations <= 5 || overallScore >= 40) {
        return { text: "Fair", color: "#f59e0b", bgColor: "#fef3c7" };
      } else {
        return { text: "Needs Review", color: "#ef4444", bgColor: "#fee2e2" };
      }
    };

    const status = getStatusBadge();
    const resultsUrl = `${base_url}/interviews/${response.interview_id}`;

    // Create email subject
    const emailSubject = `Interview Completed: ${assignee.first_name} ${assignee.last_name} - ${interview.name}`;

    // Recruiter email - simple, professional, text-focused format
    const complianceDetails =
      totalViolations === 0
        ? "Details: No rule violations were detected during the interview session."
        : [
            faceMismatchCount > 0
              ? "Face mismatch detected during the interview session."
              : null,
            tabSwitchCount > 0
              ? "Tab switching detected during the interview session."
              : null,
            cameraOffCount > 0
              ? "Camera turned off or not visible during parts of the interview."
              : null,
            multiplePersonCount > 0
              ? "Multiple persons detected during the interview session."
              : null,
          ]
            .filter(Boolean)
            .join(" ");

    const emailBodyHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 680px; margin: 0 auto; padding: 24px; background-color: #f9fafb;">
  <div style="background-color: #ffffff; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(15,23,42,0.06);">
    <p style="margin-top: 0;">Dear ${recruiterName},</p>

    <p style="margin: 0 0 12px 0;">
      I hope this email finds you well.
    </p>

    <p style="margin: 0 0 16px 0;">
      This is to inform you that the interview for the position of <strong>${interview.name}</strong> has been successfully completed.
      Please find a brief summary of the interview outcome below for your review.
    </p>

    <p style="margin: 0 0 6px 0; font-weight: 600;">Candidate Details:</p>
    <p style="margin: 0 0 12px 0;">
      <strong>Name:</strong> ${assignee.first_name} ${assignee.last_name}<br />
      <strong>Email:</strong> ${assignee.email}<br />
      ${assignee.phone ? `<strong>Contact Number:</strong> ${assignee.phone}<br />` : ""}
    </p>

    <p style="margin: 0 0 6px 0; font-weight: 600;">Interview Summary:</p>
    <ul style="margin: 0 0 12px 20px; padding: 0; color: #111827;">
      <li><strong>Overall Score:</strong> ${overallScore}%</li>
      <li><strong>Communication Score:</strong> ${communicationScore}%</li>
    </ul>

    <p style="margin: 0 0 6px 0; font-weight: 600;">Compliance Review:</p>
    <ul style="margin: 0 0 12px 20px; padding: 0; color: #111827;">
      <li><strong>Rule Violations Detected:</strong> ${totalViolations}</li>
      <li>${complianceDetails}</li>
    </ul>

    <p style="margin: 0 0 12px 0;">
      The complete interview recording, transcript, and detailed analytics are available in the interview dashboard for further evaluation.
      You can access them using your recruiter dashboard link.
    </p>

    <p style="margin: 0 0 16px 0;">
      Please let me know if any additional information is required or if you would like to proceed with the next steps.
    </p>

    <p style="margin: 0 0 4px 0;">Kind regards,</p>
    <p style="margin: 0;">
      Manish<br />
    
    </p>
  </div>
</body>
</html>
    `.trim();

    // Candidate notification email
    const assigneeEmailSubject = `Thank you for completing your interview - ${interview.name}`;
    // Candidate thank-you email in clear business format
    const assigneeEmailBodyHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 680px; margin: 0 auto; padding: 24px; background-color: #f9fafb;">
  <div style="border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(15,23,42,0.06);">
    <p style="margin-top: 0;">Dear ${assignee.first_name || ''},</p>

    <p style="margin: 0 0 12px 0;">
      Thank you for taking the time to complete your interview for the <strong>${interview.name}</strong> position.
      We have successfully received your responses.
    </p>

    <p style="margin: 0 0 12px 0;">
      Our team will now review your interview recording along with the AI-based evaluation.
      If your profile aligns with our current requirements, we will contact you regarding the next steps in the hiring process.
    </p>

    <p style="margin: 0 0 12px 0;">
      At this stage, no further action is required from your side.
    </p>

    <p style="margin: 0 0 12px 0;">
      Thank you for your interest in joining our team.
    </p>

    <p style="margin: 0;">
      Best regards,<br />
      <strong>The Hiring Team</strong><br />
    </p>
  </div>
</body>
</html>
    `.trim();

    // Send email to fixed recruiter email
    const recruiterResult = await sendEmailViaPowerAutomate(
      FIXED_RECRUITER_EMAIL,
      emailSubject,
      emailBodyHTML
    );

    if (recruiterResult.success) {
      logger.info(`Recruiter notification sent successfully to ${FIXED_RECRUITER_EMAIL}`);
    } else {
      logger.error(`Failed to send recruiter notification to ${FIXED_RECRUITER_EMAIL}:`, recruiterResult.error);
    }

    // Send confirmation email to assignee (candidate)
    const assigneeResult = await sendEmailViaPowerAutomate(
      assignee.email,
      assigneeEmailSubject,
      assigneeEmailBodyHTML
    );

    if (!assigneeResult.success) {
      logger.error(`Failed to send assignee completion email to ${assignee.email}:`, assigneeResult.error);
    }

    return NextResponse.json({
      success: !!(recruiterResult?.success || assigneeResult.success),
      message: "Notification emails processed",
      recruiterMessageId: recruiterResult?.messageId,
      assigneeMessageId: assigneeResult.messageId,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error sending recruiter notification:", errorMessage);

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

