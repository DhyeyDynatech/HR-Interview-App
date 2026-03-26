import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken, getUserById } from '@/lib/auth';
import { assigneeService } from '@/services/users.service';
import { logger } from '@/lib/logger';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user || !user.organization_id) return null;
  return { userId, organizationId: user.organization_id };
}

interface BulkTagAssignmentRequest {
  assignee_ids: number[];
  tag: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        if (assignee) existingAssignees.push(assignee);
      } catch (error) {
        logger.error(`Error fetching assignee ${id} for logging:`, error instanceof Error ? error.message : String(error));
      }
    }

    const supabase = getSupabaseClient();

    // Update only assignees that belong to the authenticated user's org
    const { data, error } = await supabase
      .from('interview_assignee')
      .update({ tag: tag || null })
      .in('id', assignee_ids)
      .eq('organization_id', auth.organizationId)
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
      const assigneeDetails = existingAssignees.map((a) => ({
        assignee_id: a.id,
        assignee_email: a.email,
        assignee_name: `${a.first_name} ${a.last_name}`,
        old_tag: a.tag || null,
        new_tag: tag || null,
      }));

      await logActivityFromRequest(request, "bulk_tag_assigned", {
        user_id: auth.userId,
        resource_type: "assignee",
        resource_id: null,
        details: {
          total_assignees: assignee_ids.length,
          tag: tag || null,
          assignees: assigneeDetails,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        },
      });
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
