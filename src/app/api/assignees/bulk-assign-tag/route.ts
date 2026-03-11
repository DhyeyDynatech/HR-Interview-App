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

interface BulkTagAssignmentRequest {
  assignee_ids: number[];
  tag: string | null;
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

    const body: BulkTagAssignmentRequest = await request.json();
    const { assignee_ids, tag } = body;

    if (!assignee_ids || !Array.isArray(assignee_ids) || assignee_ids.length === 0) {

      return NextResponse.json(
        { error: "Assignee IDs are required" },
        { status: 400 }
      );
    }

    // Get existing assignees before update for logging
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

    // Update tag for all selected assignees
    const { data, error } = await supabase
      .from('interview_assignee')
      .update({ tag: tag || null })
      .in('id', assignee_ids)
      .select();

    if (error) {
      console.error('Error assigning tag:', error);

      return NextResponse.json(
        { error: "Failed to assign tag" },
        { status: 500 }
      );
    }

    // Log bulk tag assignment
    try {
      const assigneeDetails = existingAssignees.map((existingAssignee) => {
        return {
          assignee_id: existingAssignee.id,
          assignee_email: existingAssignee.email,
          assignee_name: `${existingAssignee.first_name} ${existingAssignee.last_name}`,
          old_tag: existingAssignee.tag || null,
          new_tag: tag || null,
        };
      });

      await logActivityFromRequest(
        request,
        "bulk_tag_assigned",
        {
          user_id: userId,
          resource_type: "assignee",
          resource_id: null, // Multiple assignees
          details: {
            total_assignees: assignee_ids.length,
            tag: tag || null,
            assignees: assigneeDetails,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log bulk tag assignment:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(
      {
        message: tag
          ? `Successfully assigned tag to ${data.length} assignee(s)`
          : `Successfully removed tag from ${data.length} assignee(s)`,
        updated: data.length,
        assignees: data,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/assignees/bulk-assign-tag:", error);

    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

