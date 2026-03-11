import { NextRequest, NextResponse } from "next/server";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import * as UserService from "@/services/users.service";

/**
 * API endpoint for logging frontend actions
 * This allows the frontend to log user actions that happen client-side
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, resource_type, resource_id, details } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    // Get user ID from Supabase auth and map to user table
    let userId: string | null = null;
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
        // Get user from database to ensure we have the correct user_id
        const currentUser = await UserService.getUserById(authUser.id);
        userId = currentUser?.id || authUser.id;
      }
    } catch (error) {
      // If we can't get user, continue with null user_id
      console.error("[Log Activity] Error getting user:", error);
    }

    // Log the activity
    await logActivityFromRequest(
      request,
      action,
      {
        user_id: userId,
        resource_type: resource_type || null,
        resource_id: resource_id || null,
        details: details || null,
      }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error in POST /api/log-activity:", error);
    // Don't fail - logging should never break the app
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

