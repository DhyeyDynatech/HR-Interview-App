import { NextRequest, NextResponse } from 'next/server';
import { assigneeService } from '@/services/users.service';
import { CreateAssigneeRequest } from '@/types/user';
import { logger } from '@/lib/logger';
import { logActivityFromRequest } from '@/lib/user-activity-log';
import { verifyToken, getUserById } from '@/lib/auth';

export const dynamic = "force-dynamic";

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  return { userId, organizationId: user.organization_id, user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || auth.organizationId || undefined;
    const search = searchParams.get('search');
    const status = searchParams.get('status') as 'active' | 'inactive' | 'pending' | null;

    let assignees;
    if (search) {
      assignees = await assigneeService.searchAssignees(organizationId, search);
    } else if (status) {
      assignees = await assigneeService.getAssigneesByStatus(organizationId, status);
    } else {
      assignees = await assigneeService.getAllAssignees(organizationId);
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
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;

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
