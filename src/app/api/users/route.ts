import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import * as UserService from "@/services/users.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get current user's data from database to check role
    const currentUser = await UserService.getUserById(authUser.id);
    if (!currentUser) {

      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get organization ID from query params
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const role = searchParams.get("role");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    // For admin users, organizationId is optional (they can see all users)
    // For non-admin users, organizationId is required
    if (currentUser.role !== 'admin' && !organizationId) {

      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }

    // Use current user's organization_id if not provided and user is not admin
    const effectiveOrganizationId = organizationId || currentUser.organization_id || '';

    let users;
    if (search) {
      users = await UserService.searchUsers(effectiveOrganizationId, search, currentUser.role);
    } else if (role) {
      users = await UserService.getUsersByRole(effectiveOrganizationId, role, currentUser.role);
    } else if (status) {
      users = await UserService.getUsersByStatus(effectiveOrganizationId, status, currentUser.role);
    } else {
      users = await UserService.getAllUsers(effectiveOrganizationId, currentUser.role);
    }


    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error in GET /api/users:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { email, first_name, last_name, phone, avatar_url, organization_id, role, status } = body;

    if (!email || !organization_id) {

      return NextResponse.json({ error: "Email and organization_id are required" }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await UserService.getUserByEmail(email);
    if (existingUser) {

      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }

    const newUser = await UserService.createUser({
      email,
      first_name,
      last_name,
      phone,
      avatar_url,
      organization_id,
      role: role || "viewer",
      status: status || "active"
    }, user.id);

    if (!newUser) {

      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // Log activity
    await UserService.logUserActivity(user.id, "user_created", "user", newUser.id, { email });


    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/users:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
