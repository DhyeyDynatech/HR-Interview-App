import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logger } from "@/lib/logger";
import { logActivityFromRequest, getUserIdFromRequest } from "@/lib/user-activity-log";
import { verifyToken } from '@/lib/auth';
import * as UserService from '@/services/users.service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface BulkAssigneeImportRequest {
  users: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    status?: string;
    notes?: string;
  }>;
  organization_id?: string | null;
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
    const body: BulkAssigneeImportRequest = await request.json();
    const { users: usersToImport, organization_id } = body;

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
            error: "Email is required",
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
            error: "Invalid email",
          });
          continue;
        }

        // Check if assignee already exists
        let existingAssigneeQuery = supabase
          .from('interview_assignee')
          .select('id')
          .eq('email', userData.email);
        
        // Filter by organization_id only if it's provided
        if (organization_id) {
          existingAssigneeQuery = existingAssigneeQuery.eq('organization_id', organization_id);
        }
        
        const { data: existingAssignee } = await existingAssigneeQuery.single();
          
        if (existingAssignee) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "User already exists",
          });
          continue;
        }

        // Validate first_name and last_name (required for interview_assignee)
        if (!userData.first_name || !userData.first_name.trim()) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "First name missing",
          });
          continue;
        }

        if (!userData.last_name || !userData.last_name.trim()) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: "Last name missing",
          });
          continue;
        }

        // Validate status (TEXT field, not enum)
        const validStatuses = ['active', 'inactive', 'pending'];
        const status = userData.status?.toLowerCase() || 'active';
        if (!validStatuses.includes(status)) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: `Invalid status (use: active, inactive, pending)`,
          });
          continue;
        }

        // Create the assignee in interview_assignee table
        const insertData: any = {
          email: userData.email.trim().toLowerCase(),
          first_name: userData.first_name.trim(),
          last_name: userData.last_name.trim(),
          phone: userData.phone?.trim() || null,
          avatar_url: null,
          organization_id: organization_id || null,
          status: status,
          notes: userData.notes?.trim() || null,
          // interview_id is NULL initially (can be assigned later)
          interview_id: null,
        };

        const { data: newAssignee, error: insertError } = await supabase
          .from('interview_assignee')
          .insert([insertData])
          .select()
          .single();

        if (insertError || !newAssignee) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: insertError?.message || "Failed to create assignee",
          });
        } else {
          result.success++;
          result.imported.push(newAssignee);
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

    // Log bulk assignee import activity
    try {
      // Try to get user ID from request (Bearer token or cookies)
      let userId: string | null = null;
      
      // Try Bearer token authentication first
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        const { valid, userId: tokenUserId } = verifyToken(token);
        if (valid && tokenUserId) {
          userId = tokenUserId;
        }
      }
      
      // If Bearer token not found, try getUserIdFromRequest (cookies)
      if (!userId) {
        userId = await getUserIdFromRequest(request);
      }
      
      // If still not found, try Supabase auth cookies
      if (!userId) {
        try {
          const cookieStore = cookies();
          const supabaseAuth = createServerClient(
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
          
          const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
          if (!authError && authUser) {
            // Map Supabase auth user ID to user table ID
            const currentUser = await UserService.getUserById(authUser.id);
            userId = currentUser?.id || authUser.id;
          }
        } catch (error) {
          console.error("Error with Supabase auth:", error);
        }
      }

      // Build list of imported assignees with their details
      const importedAssignees = result.imported.map((assignee) => {
        return {
          assignee_id: assignee.id,
          assignee_email: assignee.email,
          assignee_name: `${assignee.first_name} ${assignee.last_name}`,
          phone: assignee.phone || null,
          status: assignee.status,
          organization_id: assignee.organization_id || null,
        };
      });

      // Build list of failed imports with error details
      const failedImports = result.errors.map((error) => {
        return {
          email: error.email,
          row: error.row,
          error: error.error,
        };
      });

      await logActivityFromRequest(
        request,
        "assignees_bulk_import",
        {
          user_id: userId,
          resource_type: "assignee",
          resource_id: organization_id || null,
          details: {
            organization_id: organization_id || null,
            total_assignees: usersToImport.length,
            success_count: result.success,
            failed_count: result.failed,
            imported_assignees: importedAssignees,
            failed_imports: failedImports,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log bulk assignee import activity:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(
      {
        message: `Bulk import completed. Success: ${result.success}, Failed: ${result.failed}`,
        result,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error in POST /api/users/bulk-import-noauth:", error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

