import { NextRequest, NextResponse } from "next/server";
import { resetUserPassword, verifyPasswordResetToken } from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

export async function POST(request: NextRequest) {
  try {
    const { token, newPassword } = await request.json();

    if (!token || !newPassword) {
      return NextResponse.json(
        { success: false, message: "Token and new password are required" },
        { status: 400 }
      );
    }

    // Validate password length
    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 6 characters long" },
        { status: 400 }
      );
    }

    // Verify token
    const tokenVerification = await verifyPasswordResetToken(token);
    if (!tokenVerification.valid || !tokenVerification.userId) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    // Reset password
    await resetUserPassword(token, newPassword);

    // Log password reset completion
    try {
      await logActivityFromRequest(
        request,
        "password_reset_completed",
        {
          user_id: tokenVerification.userId,
          resource_type: "auth",
          resource_id: null,
          details: {
            user_id: tokenVerification.userId,
            timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      console.error("Failed to log password reset completion:", logError);
    }

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    if (error instanceof Error) {
      if (error.message === "Invalid or expired reset token") {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again later." },
      { status: 500 }
    );
  }
}

