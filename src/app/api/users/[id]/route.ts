import { NextRequest, NextResponse } from "next/server";
import * as UserService from "@/services/users.service";
import { verifyToken, getUserById } from "@/lib/auth";

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

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
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
    const auth = await extractAuth(request);
    if (!auth) {
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
    await UserService.logUserActivity(auth.userId, "user_updated", "user", userId, { updatedFields: Object.keys(body) });

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
    const auth = await extractAuth(request);
    if (!auth) {
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
    await UserService.logUserActivity(auth.userId, "user_deleted", "user", userId, { email: existingUser.email });

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error in DELETE /api/users/[id]:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
