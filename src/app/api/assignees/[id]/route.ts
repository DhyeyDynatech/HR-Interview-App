import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { assigneeService } from '@/services/users.service';
import * as UserService from '@/services/users.service';
import { UpdateAssigneeRequest } from '@/types/user';
import { logger } from '@/lib/logger';
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    if (authError || !user) {

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assigneeId = parseInt(params.id);
    if (isNaN(assigneeId)) {

      return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 });
    }

    const assignee = await assigneeService.getAssigneeById(assigneeId);
    if (!assignee) {

      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }


    return NextResponse.json(assignee);
  } catch (error) {
    logger.error('Error in GET /api/assignees/[id]:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const assigneeId = parseInt(params.id);
    if (isNaN(assigneeId)) {

      return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 });
    }

    const body: UpdateAssigneeRequest = await request.json();
    
    // Check if assignee exists
    const existingAssignee = await assigneeService.getAssigneeById(assigneeId);
    if (!existingAssignee) {

      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    // If email is being updated, check for duplicates
    if (body.email && body.email !== existingAssignee.email) {
      const duplicateAssignee = await assigneeService.getAssigneeByEmail(body.email, existingAssignee.organization_id);
      if (duplicateAssignee && duplicateAssignee.id !== assigneeId) {

        return NextResponse.json(
          { error: 'An assignee with this email already exists in this organization' },
          { status: 409 }
        );
      }
    }

    const updatedAssignee = await assigneeService.updateAssignee(assigneeId, body);
    
    // Log assignee update
    try {
      const updatedFields = Object.keys(body);
      
      // Build old_values and new_values objects for only the fields that were updated
      const oldValues: Record<string, any> = {};
      const newValues: Record<string, any> = {};
      
      // Map of field names to their values in existingAssignee
      const fieldMappings: Record<string, string> = {
        'first_name': 'first_name',
        'last_name': 'last_name',
        'email': 'email',
        'phone': 'phone',
        'avatar_url': 'avatar_url',
        'resume_url': 'resume_url',
        'status': 'status',
        'interview_id': 'interview_id',
        'notes': 'notes',
        'tag': 'tag',
        'applicant_id': 'applicant_id',
        'review_status': 'review_status',
        'interview_status': 'interview_status',
        'allow_retake': 'allow_retake',
        'organization_id': 'organization_id',
      };
      
      // For each field that was updated, capture old and new values
      for (const field of updatedFields) {
        const mappedField = fieldMappings[field];
        if (mappedField) {
          // Get old value from existingAssignee
          const oldValue = existingAssignee[mappedField as keyof typeof existingAssignee];
          oldValues[field] = oldValue !== undefined && oldValue !== null ? oldValue : null;
          
          // Get new value from body (what was sent) or updatedAssignee (what was saved)
          const fieldKey = field as keyof UpdateAssigneeRequest;
          const newValue = body[fieldKey] !== undefined ? body[fieldKey] : updatedAssignee[mappedField as keyof typeof updatedAssignee];
          newValues[field] = newValue !== undefined && newValue !== null ? newValue : null;
        }
      }
      
      await logActivityFromRequest(
        request,
        "assignee_updated",
        {
          user_id: userId, // Use mapped user ID
          resource_type: "assignee",
          resource_id: assigneeId.toString(),
          details: {
            assignee_id: assigneeId,
            assignee_email: updatedAssignee.email,
            assignee_name: `${updatedAssignee.first_name} ${updatedAssignee.last_name}`,
            interview_id: updatedAssignee.interview_id || null,
            organization_id: updatedAssignee.organization_id || null,
            old_values: oldValues,
            new_values: newValues,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log assignee update:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(updatedAssignee);
  } catch (error) {
    logger.error('Error in PUT /api/assignees/[id]:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const assigneeId = parseInt(params.id);
    if (isNaN(assigneeId)) {

      return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 });
    }

    // Check if assignee exists
    const existingAssignee = await assigneeService.getAssigneeById(assigneeId);
    if (!existingAssignee) {

      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    // Store assignee info before deletion for logging
    const assigneeInfo = {
      id: existingAssignee.id,
      email: existingAssignee.email,
      name: `${existingAssignee.first_name} ${existingAssignee.last_name}`,
      organization_id: existingAssignee.organization_id,
      interview_id: existingAssignee.interview_id,
      status: existingAssignee.status,
    };

    await assigneeService.deleteAssignee(assigneeId);
    
    // Log assignee deletion
    try {
      await logActivityFromRequest(
        request,
        "assignee_deleted",
        {
          user_id: userId, // Use mapped user ID
          resource_type: "assignee",
          resource_id: assigneeId.toString(),
          details: {
            assignee_id: assigneeId,
            assignee_email: assigneeInfo.email,
            assignee_name: assigneeInfo.name,
            organization_id: assigneeInfo.organization_id || null,
            interview_id: assigneeInfo.interview_id || null,
            status: assigneeInfo.status,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log assignee deletion:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json({ message: 'Assignee deleted successfully' });
  } catch (error) {
    logger.error('Error in DELETE /api/assignees/[id]:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
