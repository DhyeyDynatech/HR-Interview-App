import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { assigneeService } from '@/services/users.service';
import * as UserService from '@/services/users.service';
import { CreateAssigneeRequest } from '@/types/user';
import { logger } from '@/lib/logger';
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
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
    
    // Get current user and organization
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');
    const search = searchParams.get('search');
    const status = searchParams.get('status') as 'active' | 'inactive' | 'pending' | null;

    let assignees;
    if (search) {
      assignees = await assigneeService.searchAssignees(organizationId || undefined, search);
    } else if (status) {
      assignees = await assigneeService.getAssigneesByStatus(organizationId || undefined, status);
    } else {
      assignees = await assigneeService.getAllAssignees(organizationId || undefined);
    }


    return NextResponse.json(assignees);
  } catch (error) {
    logger.error('Error in GET /api/assignees:', error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
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

    const body: CreateAssigneeRequest = await request.json();
    
    // Ensure fields default to empty string so the insert never fails
    body.first_name = body.first_name || "";
    body.last_name = body.last_name || "";
    body.email = body.email || "";

    // Check if assignee already exists with this email (only when email is provided)
    if (body.email) {
      const existingAssignee = await assigneeService.getAssigneeByEmail(body.email, body.organization_id || undefined);
      if (existingAssignee) {

        return NextResponse.json(
          { error: 'An assignee with this email already exists' },
          { status: 409 }
        );
      }
    }

    const assignee = await assigneeService.createAssignee(body);
    
    // Log assignee creation
    try {
      await logActivityFromRequest(
        request,
        "assignee_created",
        {
          user_id: userId, // Use mapped user ID
          resource_type: "assignee",
          resource_id: assignee.id.toString(),
          details: {
            assignee_id: assignee.id,
            assignee_email: assignee.email,
            assignee_name: `${assignee.first_name} ${assignee.last_name}`,
            organization_id: assignee.organization_id || null,
            status: assignee.status,
            interview_id: assignee.interview_id || null,
            creation_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      logger.error("Failed to log assignee creation:", logError instanceof Error ? logError.message : String(logError));
    }

    return NextResponse.json(assignee, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/assignees:', error instanceof Error ? error.message : JSON.stringify(error));

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
