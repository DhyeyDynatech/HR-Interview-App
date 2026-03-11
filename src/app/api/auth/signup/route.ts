import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmail,
  createUser,
  generateToken,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password, first_name, last_name } = await request.json();

    // Validation
    if (!email || !password || !first_name || !last_name) {

      return NextResponse.json(
        { success: false, message: "All fields are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {

      return NextResponse.json(
        { success: false, message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {

      return NextResponse.json(
        { success: false, message: "User with this email already exists" },
        { status: 409 }
      );
    }

    // Create user
    const user = await createUser({
      email,
      password,
      first_name,
      last_name,
    });

    // Generate token
    const token = generateToken(user.id);

    // Return session

    return NextResponse.json({
      success: true,
      session: {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          avatar_url: user.avatar_url,
          organization_id: user.organization_id,
          role: user.role,
          status: user.status,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
  } catch (error) {
    console.error("Signup error:", error);

    return NextResponse.json(
      { success: false, message: "An error occurred during signup" },
      { status: 500 }
    );
  }
}
