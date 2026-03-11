import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import * as UserService from "@/services/users.service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = params.id;
    const userData = await UserService.getUserById(userId);

    if (!userData) {

      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }


    return NextResponse.json({ user: userData });
  } catch (error) {
    console.error("Error in GET /api/users/[id]:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = params.id;
    const body = await request.json();
    const { first_name, last_name, phone, avatar_url, role, status } = body;

    const updatedUser = await UserService.updateUser(userId, {
      first_name,
      last_name,
      phone,
      avatar_url,
      role,
      status
    });

    if (!updatedUser) {

      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }

    // Log activity
    await UserService.logUserActivity(user.id, "user_updated", "user", userId, { updatedFields: Object.keys(body) });


    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("Error in PUT /api/users/[id]:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = params.id;

    // Check if user exists
    const existingUser = await UserService.getUserById(userId);
    if (!existingUser) {

      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const success = await UserService.deleteUser(userId);

    if (!success) {

      return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }

    // Log activity
    await UserService.logUserActivity(user.id, "user_deleted", "user", userId, { email: existingUser.email });


    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error in DELETE /api/users/[id]:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
