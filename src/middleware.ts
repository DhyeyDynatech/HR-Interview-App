import { NextRequest, NextResponse } from "next/server";

// Public routes that don't require authentication
const publicRoutes = [
  "/",
  "/sign-in",
  // "/sign-up",
  "/interview",
  "/call",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/logout",
  "/api/register-call",
  "/api/get-call",
  "/api/generate-interview-questions",
  // "/api/create-interviewer", // DISABLED - Interviewer creation not allowed
  "/api/analyze-communication",
  "/api/response-webhook",
  "/api/validate-user",
  "/api/users/bulk-import-noauth",
  "/api/get-assignee-photo",
];

// Routes that require authentication
const protectedRoutes = [
  "/dashboard",
];

function isPublicRoute(pathname: string): boolean {

  return publicRoutes.some(route => {
    if (route.endsWith("/")) {

      return pathname === route || pathname.startsWith(route);
    }

    return pathname === route || pathname.startsWith(route + "/");
  });
}

function isProtectedRoute(pathname: string): boolean {

  return protectedRoutes.some(route => 
    pathname === route || pathname.startsWith(route + "/")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (isPublicRoute(pathname)) {

    return NextResponse.next();
  }

  // Check for authentication token
  const token = request.cookies.get("auth_token")?.value || 
                request.headers.get("Authorization")?.replace("Bearer ", "");

  // For protected routes, redirect to sign-in if not authenticated
  if (isProtectedRoute(pathname) && !token) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", pathname);

    return NextResponse.redirect(signInUrl);
  }

  // For API routes, return 401 if not authenticated
  if (pathname.startsWith("/api/") && !token) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }


  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
