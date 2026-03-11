import { NextRequest, NextResponse } from "next/server";
import { verifyToken, updateUserPassword } from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

export async function PUT(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { valid, userId } = verifyToken(token);

    if (!valid || !userId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ 
        error: "Current password and new password are required" 
      }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ 
        error: "New password must be at least 6 characters long" 
      }, { status: 400 });
    }

    // Update password
    await updateUserPassword(userId, currentPassword, newPassword);

    // Log password change
    try {
      await logActivityFromRequest(
        request,
        "password_changed",
        {
          user_id: userId,
          resource_type: "user",
          resource_id: userId,
          details: {
            user_id: userId,
            change_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      console.error("Failed to log password change:", logError);
    }

    return NextResponse.json({ 
      message: "Password updated successfully" 
    });
  } catch (error) {
    console.error("Error in PUT /api/profile/password:", error);
    
    if (error instanceof Error) {
      if (error.message === "Current password is incorrect") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.message === "User not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    
    return NextResponse.json({ 
      error: "Internal server error" 
    }, { status: 500 });
  }
}

