import { NextRequest, NextResponse } from "next/server";
import { logActivityFromRequest, getUserIdFromRequest } from "@/lib/user-activity-log";

export async function POST(request: NextRequest) {
  try {
    // Get user ID from request before logout
    const userId = await getUserIdFromRequest(request);

    // Log logout activity
    try {
      await logActivityFromRequest(
        request,
        "logout",
        {
          user_id: userId,
          resource_type: "auth",
          resource_id: null,
          details: {
            user_id: userId,
            logout_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      // Don't fail the request if logging fails
      console.error("Failed to log logout activity:", logError);
    }

    // In a more sophisticated setup, you'd invalidate the token in a database
    // For now, the client just removes the token from localStorage

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    // Still return success even if logging fails
    return NextResponse.json({ success: true });
  }
}

