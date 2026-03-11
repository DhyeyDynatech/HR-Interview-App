import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Create Supabase client for activity logging
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Use service role key if available (for bypassing RLS), otherwise use anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    throw new Error("Supabase key is required. Please set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment variables.");
  }

  if (!supabaseUrl) {
    throw new Error("Supabase URL is required. Please set NEXT_PUBLIC_SUPABASE_URL in your environment variables.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export interface ActivityLogData {
  user_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: Record<string, any> | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

/**
 * Extract IP address from NextRequest
 */
export function getIpAddress(request: NextRequest): string | null {
  // Try various headers that might contain the real IP
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback to remote address if available
  const remoteAddress = request.headers.get("remote-addr");
  if (remoteAddress) {
    return remoteAddress;
  }

  return null;
}

/**
 * Extract user agent from NextRequest
 */
export function getUserAgent(request: NextRequest): string | null {
  return request.headers.get("user-agent") || null;
}

/**
 * Extract user ID from NextRequest
 * Supports both token-based auth and Supabase auth
 */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  try {
    // Try token-based auth first (Bearer token)
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const { verifyToken } = await import("./auth");
      const token = authHeader.split(" ")[1];
      const { valid, userId } = verifyToken(token);
      if (valid && userId) {
        return userId;
      }
    }

    // Try Supabase auth (cookies) - only in server context
    try {
      const { cookies } = await import("next/headers");
      const { createServerClient } = await import("@supabase/ssr");
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

      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user) {
        return user.id;
      }
    } catch (error) {
      // Supabase auth not available (might be in wrong context), continue
    }

    return null;
  } catch (error) {
    console.error("Error extracting user ID from request:", error);
    return null;
  }
}

/**
 * Log user activity to the database
 */
export async function logUserActivity(data: ActivityLogData): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const logData = {
      user_id: data.user_id || null,
      action: data.action,
      resource_type: data.resource_type || null,
      resource_id: data.resource_id || null,
      details: data.details || null,
      ip_address: data.ip_address || null,
      user_agent: data.user_agent || null,
    };

    console.log("[Activity Log] Attempting to log:", {
      action: data.action,
      user_id: data.user_id,
      resource_type: data.resource_type,
      resource_id: data.resource_id,
    });

    const { data: insertedData, error } = await supabase
      .from("user_activity_log")
      .insert(logData)
      .select();

    if (error) {
      // If foreign key constraint fails, try without user_id
      if (error.code === '23503' || error.message?.includes('foreign key')) {
        console.warn("[Activity Log] Foreign key constraint failed, retrying without user_id:", {
          original_user_id: logData.user_id,
          action: data.action,
        });
        
        const logDataWithoutUserId = {
          ...logData,
          user_id: null, // Set to null if foreign key constraint fails
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from("user_activity_log")
          .insert(logDataWithoutUserId)
          .select();
        
        if (retryError) {
          console.error("[Activity Log] Retry also failed:", {
            error: retryError,
            message: retryError.message,
            code: retryError.code,
          });
        } else {
          console.log("[Activity Log] Successfully logged without user_id:", {
            action: data.action,
            log_id: retryData?.[0]?.id,
          });
        }
      } else {
        console.error("[Activity Log] Database error:", {
          error: error,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          logData: logData,
        });
      }
      // Don't throw - logging failures shouldn't break the main flow
    } else {
      console.log("[Activity Log] Successfully logged:", {
        action: data.action,
        log_id: insertedData?.[0]?.id,
        user_id: logData.user_id,
      });
    }
  } catch (error) {
    console.error("[Activity Log] Exception during logging:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      action: data.action,
    });
    // Don't throw - logging failures shouldn't break the main flow
  }
}

/**
 * Convenience function to log activity from a NextRequest
 * Automatically extracts user_id, ip_address, and user_agent
 */
export async function logActivityFromRequest(
  request: NextRequest,
  action: string,
  options?: {
    resource_type?: string | null;
    resource_id?: string | null;
    details?: Record<string, any> | null;
    user_id?: string | null; // Override auto-detection
  }
): Promise<void> {
  const user_id = options?.user_id ?? (await getUserIdFromRequest(request));
  const ip_address = getIpAddress(request);
  const user_agent = getUserAgent(request);

  await logUserActivity({
    user_id,
    action,
    resource_type: options?.resource_type || null,
    resource_id: options?.resource_id || null,
    details: options?.details || null,
    ip_address,
    user_agent,
  });
}

