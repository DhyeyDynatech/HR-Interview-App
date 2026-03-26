import { NextRequest, NextResponse } from "next/server";
import * as UserService from "@/services/users.service";
import { verifyToken, getUserById } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  return { userId, user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = auth.user;

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
    const auth = await extractAuth(request);
    if (!auth) {
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
    }, auth.userId);

    if (!newUser) {

      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // Log activity
    await UserService.logUserActivity(auth.userId, "user_created", "user", newUser.id, { email });


    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/users:", error);

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
