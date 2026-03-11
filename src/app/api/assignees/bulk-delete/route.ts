import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken } from '@/lib/auth';
import * as UserService from '@/services/users.service';
import { assigneeService } from '@/services/users.service';
import { logger } from '@/lib/logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface BulkDeleteRequest {
  assignee_ids: number[];
}

export async function POST(request: NextRequest) {
  try {
    // Try Bearer token authentication first (used by the app)
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { valid, userId: tokenUserId } = verifyToken(token);
      if (valid && tokenUserId) {
        userId = tokenUserId;
      }
    }
    
    // If Bearer token not found, try Supabase auth cookies
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

    const body: BulkDeleteRequest = await request.json();
    const { assignee_ids } = body;

    if (!assignee_ids || !Array.isArray(assignee_ids) || assignee_ids.length === 0) {

      return NextResponse.json(
        { error: "Assignee IDs are required" },
        { status: 400 }
      );
    }

    // Get existing assignees before deletion for logging
    const existingAssignees = [];
    for (const id of assignee_ids) {
      try {
        const assignee = await assigneeService.getAssigneeById(id);
        if (assignee) {
          existingAssignees.push(assignee);
        }
      } catch (error) {
        logger.error(`Error fetching assignee ${id} for logging:`, error instanceof Error ? error.message : String(error));
      }
    }

    // Delete all selected assignees
    const { data, error } = await supabase
      .from('interview_assignee')
      .delete()
      .in('id', assignee_ids)
      .select();

    if (error) {
      console.error('Error deleting assignees:', error);

      return NextResponse.json(
        { error: "Failed to delete assignees" },
        { status: 500 }
      );
    }

    // Log bulk deletion
    try {
      const assigneeDetails = existingAssignees.map((existingAssignee) => {
        return {
          assignee_id: existingAssignee.id,
          assignee_email: existingAssignee.email,
          assignee_name: `${existingAssignee.first_name} ${existingAssignee.last_name}`,
          organization_id: existingAssignee.organization_id || null,
          interview_id: existingAssignee.interview_id || null,
          status: existingAssignee.status,
        };
      });

      await logActivityFromRequest(
        request,
        "bulk_assignee_deleted",
        {
          user_id: userId,
          resource_type: "assignee",
          resource_id: null, // Multiple assignees
          details: {
            total_assignees: assignee_ids.length,
            assignees: assigneeDetails,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log bulk deletion:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(
      {
        message: `Successfully deleted ${data.length} assignee(s)`,
        deleted: data.length,
        assignees: data,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/assignees/bulk-delete:", error);

    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

