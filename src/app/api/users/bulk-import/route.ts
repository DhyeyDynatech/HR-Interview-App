import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import * as UserService from "@/services/users.service";
import { logger } from "@/lib/logger";
import { logActivityFromRequest } from "@/lib/user-activity-log";

interface BulkUserImportRequest {
  users: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role?: string;
    status?: string;
  }>;
  organization_id: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    email: string;
    error: string;
  }>;
  imported: Array<any>;
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
    
    // Add debug logging
    console.log('Auth check:', { 
      hasUser: !!user, 
      userId: user?.id,
      hasError: !!authError,
      errorMessage: authError?.message 
    });
    
    if (authError || !user) {
      logger.error("Bulk import auth error:", authError?.message || "No user found");

      return NextResponse.json({ 
        error: "Unauthorized", 
        details: authError?.message || "No authenticated user found"
      }, { status: 401 });
    }

    const body: BulkUserImportRequest = await request.json();
    const { users: usersToImport, organization_id } = body;

    if (!organization_id) {

      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }

    if (!usersToImport || !Array.isArray(usersToImport) || usersToImport.length === 0) {

      return NextResponse.json(
        { error: "Users array is required and cannot be empty" },
        { status: 400 }
      );
    }

    // Validate users array length
    if (usersToImport.length > 1000) {

      return NextResponse.json(
        { error: "Cannot import more than 1000 users at once" },
        { status: 400 }
      );
    }

    const result: ImportResult = {
      success: 0,
      failed: 0,
      errors: [],
      imported: [],
    };

    // Process each user
    for (let i = 0; i < usersToImport.length; i++) {
      const userData = usersToImport[i];
      const rowNumber = i + 2; // +2 because row 1 is header and array is 0-indexed

      try {
        // Validate required fields
        if (!userData.email || typeof userData.email !== 'string') {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email || 'N/A',
            error: "Email is required and must be a valid string",
          });
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "Invalid email format",
          });
          continue;
        }

        // Check if user already exists
        const existingUser = await UserService.getUserByEmail(userData.email);
        if (existingUser) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "User with this email already exists",
          });
          continue;
        }

        // Validate role
        const validRoles = ['admin', 'manager', 'interviewer', 'viewer'];
        const role = userData.role?.toLowerCase() || 'viewer';
        if (!validRoles.includes(role)) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
          });
          continue;
        }

        // Validate status
        const validStatuses = ['active', 'inactive', 'pending', 'suspended'];
        const status = userData.status?.toLowerCase() || 'active';
        if (!validStatuses.includes(status)) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          });
          continue;
        }

        // Create the user
        const newUser = await UserService.createUser(
          {
            email: userData.email.trim().toLowerCase(),
            first_name: userData.first_name?.trim() || '',
            last_name: userData.last_name?.trim() || '',
            phone: userData.phone?.trim() || '',
            avatar_url: '',
            organization_id,
            role: role as any,
            status: status as any,
          },
          user.id
        );

        if (newUser) {
          result.success++;
          result.imported.push(newUser);
          
          // Log activity
          await UserService.logUserActivity(
            user.id,
            "user_bulk_imported",
            "user",
            newUser.id,
            { email: userData.email, row: rowNumber }
          );
        } else {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "Failed to create user",
          });
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: rowNumber,
          email: userData.email || 'N/A',
          error: error instanceof Error ? error.message : "Unknown error occurred",
        });
      }
    }

    // Log bulk import activity
    try {
      await logActivityFromRequest(
        request,
        "users_bulk_import",
        {
          user_id: user.id,
          resource_type: "user",
          resource_id: organization_id,
          details: {
            organization_id: organization_id,
            total_users: usersToImport.length,
            success_count: result.success,
            failed_count: result.failed,
            import_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log bulk import activity:", logError instanceof Error ? logError.message : String(logError));
    }


    return NextResponse.json(
      {
        message: `Bulk import completed. Success: ${result.success}, Failed: ${result.failed}`,
        result,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error in POST /api/users/bulk-import:", error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

