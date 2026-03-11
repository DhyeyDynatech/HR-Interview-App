import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getUserById } from "@/lib/auth";


export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {

      return NextResponse.json(
        { success: false, message: "No token provided" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const { valid, userId } = verifyToken(token);

    if (!valid || !userId) {

      return NextResponse.json(
        { success: false, message: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get user
    const user = await getUserById(userId);
    if (!user) {

      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }


    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Session check error:", error);

    return NextResponse.json(
      { success: false, message: "An error occurred" },
      { status: 500 }
    );
  }
}
