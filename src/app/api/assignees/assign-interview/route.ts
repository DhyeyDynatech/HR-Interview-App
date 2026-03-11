import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { assigneeService } from '@/services/users.service';
import * as UserService from '@/services/users.service';
import { AssignInterviewRequest, UnassignInterviewRequest } from '@/types/user';
import { logger } from '@/lib/logger';
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken } from '@/lib/auth';

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
        
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        if (!authError && authUser) {
          // Map Supabase auth user ID to user table ID
          const currentUser = await UserService.getUserById(authUser.id);
          userId = currentUser?.id || authUser.id;
        }
      } catch (error) {
        console.error("Error with Supabase auth:", error);
      }
    }
    
    // If still no user ID, return unauthorized
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: AssignInterviewRequest = await request.json();
    
    // Validate required fields
    if (!body.assignee_id || !body.interview_id || !body.assigned_by) {

      return NextResponse.json(
        { error: 'Assignee ID, interview ID, and assigned by are required' },
        { status: 400 }
      );
    }

    // Check if assignee exists
    const assignee = await assigneeService.getAssigneeById(body.assignee_id);
    if (!assignee) {

      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    // Check if assignee is already assigned to an interview
    if (assignee.interview_id) {

      return NextResponse.json(
        { error: 'Assignee is already assigned to an interview' },
        { status: 409 }
      );
    }

    const updatedAssignee = await assigneeService.assignInterview(body);
    
    // Log interview assignment
    try {
      await logActivityFromRequest(
        request,
        "interview_assigned",
        {
          user_id: userId, // Use mapped user ID
          resource_type: "assignee",
          resource_id: body.assignee_id.toString(),
          details: {
            assignee_id: body.assignee_id,
            assignee_email: assignee.email,
            assignee_name: `${assignee.first_name} ${assignee.last_name}`,
            interview_id: body.interview_id,
            assigned_by: body.assigned_by,
            notes: body.notes || null,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log interview assignment:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(updatedAssignee);
  } catch (error) {
    logger.error('Error in POST /api/assignees/assign-interview:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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
        
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        if (!authError && authUser) {
          // Map Supabase auth user ID to user table ID
          const currentUser = await UserService.getUserById(authUser.id);
          userId = currentUser?.id || authUser.id;
        }
      } catch (error) {
        console.error("Error with Supabase auth:", error);
      }
    }
    
    // If still no user ID, return unauthorized
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: UnassignInterviewRequest = await request.json();
    
    // Validate required fields
    if (!body.assignee_id || !body.assigned_by) {

      return NextResponse.json(
        { error: 'Assignee ID and assigned by are required' },
        { status: 400 }
      );
    }

    // Check if assignee exists
    const assignee = await assigneeService.getAssigneeById(body.assignee_id);
    if (!assignee) {

      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    // Check if assignee is assigned to an interview
    if (!assignee.interview_id) {

      return NextResponse.json(
        { error: 'Assignee is not assigned to any interview' },
        { status: 409 }
      );
    }

    // Store interview_id before unassignment for logging
    const previousInterviewId = assignee.interview_id;

    const updatedAssignee = await assigneeService.unassignInterview(body);
    
    // Log interview unassignment
    try {
      await logActivityFromRequest(
        request,
        "interview_unassigned",
        {
          user_id: userId, // Use mapped user ID
          resource_type: "assignee",
          resource_id: body.assignee_id.toString(),
          details: {
            assignee_id: body.assignee_id,
            assignee_email: assignee.email,
            assignee_name: `${assignee.first_name} ${assignee.last_name}`,
            interview_id: previousInterviewId,
            unassigned_by: body.assigned_by,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log interview unassignment:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(updatedAssignee);
  } catch (error) {
    logger.error('Error in DELETE /api/assignees/assign-interview:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
