import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmail,
  generatePasswordResetToken,
  savePasswordResetToken,
} from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

// Power Automate email config (same env vars used elsewhere)
const POWER_AUTOMATE_FLOW_URL = process.env.POWER_AUTOMATE_FLOW_URL || "";
const POWER_AUTOMATE_ACCESS_TOKEN = process.env.POWER_AUTOMATE_ACCESS_TOKEN;
const POWER_AUTOMATE_SAS_TOKEN = process.env.POWER_AUTOMATE_SAS_TOKEN;

async function sendEmailViaPowerAutomate(to: string, subject: string, body: string) {
  if (!POWER_AUTOMATE_FLOW_URL) {
    console.warn(
      "POWER_AUTOMATE_FLOW_URL is not configured. Skipping password reset email send."
    );
    return { success: false, error: "POWER_AUTOMATE_FLOW_URL not configured" };
  }

  try {
    const requestBody = {
      emailMeta: {
        to,
        subject,
        body,
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
      flowUrl = `${flowUrl}${separator}sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=${encodeURIComponent(
        sigValue
      )}`;
    }

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
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Power Automate password reset email error: ${response.status} - ${errorText}`
      );
      return {
        success: false,
        error: `Power Automate API returned ${response.status}: ${errorText}`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending password reset email via Power Automate:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { success: false, message: "Email is required" },
        { status: 400 }
      );
    }

    // Get user by email
    const user = await getUserByEmail(email);

    // Check if user exists
    if (!user) {
      return NextResponse.json({
        success: false,
        message: "Email is not found",
      });
    }

    // Check if user has a password set up
    if (!user.password_hash) {
      return NextResponse.json({
        success: false,
        message: "Email is not found",
      });
    }

    // Generate reset token
    const resetToken = generatePasswordResetToken();

    // Save reset token to user
    await savePasswordResetToken(user.id, resetToken);

    // Build reset link
    const resetLink = `${process.env.NEXT_PUBLIC_LIVE_URL}/reset-password?token=${resetToken}`;

    // Send password reset email via Power Automate (if configured)
    const subject = "Reset your password - FoloUp";
    const bodyHtml = `
<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!--[if gte mso 9]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
  </head>
  <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f9fafb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f9fafb; padding: 24px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px;">
            <tr>
              <td style="padding: 32px;">
                <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 24px;">Reset your password</h2>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0;">
                  We received a request to reset the password for your account associated with
                  <strong>${user.email}</strong>.
                </p>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0 0 24px 0;">
                  Click the button below to choose a new password. This link will be valid for a limited time.
                </p>
                <div style="margin: 24px 0; text-align: center;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${resetLink}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="10%" strokecolor="#4f46e5" fillcolor="#4f46e5">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Reset Password</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="${resetLink}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 14px; font-weight: 600; color: #ffffff; background-color: #4f46e5; text-decoration: none; border-radius: 8px;">Reset Password</a>
                  <!--<![endif]-->
                </div>
                <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
                  If the button above does not work, copy and paste this link into your browser:
                </p>
                <p style="margin: 0 0 24px 0;">
                  <a href="${resetLink}" style="color: #4f46e5; font-size: 12px; word-break: break-all;">${resetLink}</a>
                </p>
                <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">
                  If you did not request a password reset, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim();

    const emailResult = await sendEmailViaPowerAutomate(user.email, subject, bodyHtml);
    if (!emailResult.success) {
      console.warn(
        "Password reset email was not sent via Power Automate:",
        emailResult.error
      );
    }

    // Log password reset request
    try {
      await logActivityFromRequest(request, "password_reset_requested", {
        user_id: user.id,
        resource_type: "auth",
        resource_id: null,
        details: {
          email: user.email,
          user_id: user.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (logError) {
      console.error("Failed to log password reset request:", logError);
    }

    // For development, also log the link for quick testing
    if (process.env.NODE_ENV === "development") {
      console.log("Password reset link (DEV ONLY):", resetLink);
    }

    return NextResponse.json({
      success: true,
      message: "Password reset link has been sent to your email address.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again later." },
      { status: 500 }
    );
  }
}

