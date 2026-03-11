import { NextRequest, NextResponse } from "next/server";
import { verifyToken, updateUserProfile, getUserById } from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

// Force dynamic rendering - this route uses request headers
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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

    // Get user profile
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error in GET /api/profile:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
    const { first_name, last_name, phone, avatar_url } = body;

    // Get existing user data before update for logging
    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update user profile
    const updatedUser = await updateUserProfile(userId, {
      first_name,
      last_name,
      phone,
      avatar_url,
    });

    // Log profile update
    try {
      const updatedFields = Object.keys(body).filter(key => body[key] !== undefined);
      await logActivityFromRequest(
        request,
        "profile_updated",
        {
          user_id: userId,
          resource_type: "user",
          resource_id: userId,
          details: {
            user_id: userId,
            email: existingUser.email,
            updated_fields: updatedFields,
            previous_first_name: existingUser.first_name,
            new_first_name: first_name || existingUser.first_name,
            previous_last_name: existingUser.last_name,
            new_last_name: last_name || existingUser.last_name,
            previous_phone: existingUser.phone || null,
            new_phone: phone || existingUser.phone || null,
            previous_avatar_url: existingUser.avatar_url || null,
            new_avatar_url: avatar_url || existingUser.avatar_url || null,
            update_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      console.error("Failed to log profile update:", logError);
    }

    return NextResponse.json({ 
      message: "Profile updated successfully",
      user: updatedUser 
    });
  } catch (error) {
    console.error("Error in PUT /api/profile:", error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }, { status: 500 });
  }
}

