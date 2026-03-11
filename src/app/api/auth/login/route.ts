import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmail,
  verifyPassword,
  generateToken,
  updateUserLastLogin,
} from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {

      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    // Get user by email
    const user = await getUserByEmail(email);

    if (!user) {
      // Log failed login attempt
      try {
        await logActivityFromRequest(
          request,
          "login_failed",
          {
            user_id: null,
            resource_type: "auth",
            resource_id: null,
            details: {
              email: email,
              reason: "User not found",
              timestamp: new Date().toISOString(),
            },
          }
        );
      } catch (logError) {
        // Don't fail the request if logging fails
        console.error("Failed to log failed login attempt:", logError);
      }

      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check if user has password_hash (they've set up a password)
    if (!user.password_hash) {
      // Log failed login attempt
      try {
        await logActivityFromRequest(
          request,
          "login_failed",
          {
            user_id: user.id,
            resource_type: "auth",
            resource_id: null,
            details: {
              email: email,
              user_id: user.id,
              reason: "Password not set up",
              timestamp: new Date().toISOString(),
            },
          }
        );
      } catch (logError) {
        console.error("Failed to log failed login attempt:", logError);
      }

      return NextResponse.json(
        { success: false, message: "Please set up your password first" },
        { status: 401 }
      );
    }

    // Verify password
    if (!verifyPassword(password, user.password_hash)) {
      // Log failed login attempt
      try {
        await logActivityFromRequest(
          request,
          "login_failed",
          {
            user_id: user.id,
            resource_type: "auth",
            resource_id: null,
            details: {
              email: email,
              user_id: user.id,
              reason: "Invalid password",
              timestamp: new Date().toISOString(),
            },
          }
        );
      } catch (logError) {
        console.error("Failed to log failed login attempt:", logError);
      }

      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Generate token
    const token = generateToken(user.id);

    // Update last login
    await updateUserLastLogin(user.id);

    // Log successful login
    try {
      await logActivityFromRequest(
        request,
        "login_success",
        {
          user_id: user.id,
          resource_type: "auth",
          resource_id: null,
          details: {
            email: user.email,
            user_id: user.id,
            organization_id: user.organization_id,
            role: user.role,
            login_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      // Don't fail the request if logging fails
      console.error("Failed to log login activity:", logError);
    }

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
    console.error("Login error:", error);

    return NextResponse.json(
      { success: false, message: "An error occurred during login" },
      { status: 500 }
    );
  }
}
