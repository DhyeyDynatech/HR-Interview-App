import { NextRequest, NextResponse } from "next/server";
import * as UserService from "@/services/users.service";
import { logger } from "@/lib/logger";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { verifyToken, getUserById } from "@/lib/auth";

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

interface BulkUserImportRequest {
  users: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role?: string;
    status?: string;
  }>;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; email: string; error: string }>;
  imported: Array<any>;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: BulkUserImportRequest = await request.json();
    const { users: usersToImport } = body;

    if (!usersToImport || !Array.isArray(usersToImport) || usersToImport.length === 0) {
      return NextResponse.json(
        { error: "Users array is required and cannot be empty" },
        { status: 400 }
      );
    }

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

    for (let i = 0; i < usersToImport.length; i++) {
      const userData = usersToImport[i];
      const rowNumber = i + 2;

      try {
        if (!userData.email || typeof userData.email !== 'string') {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email || 'N/A', error: "Email is required and must be a valid string" });
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "Invalid email format" });
          continue;
        }

        const existingUser = await UserService.getUserByEmail(userData.email);
        if (existingUser) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "User with this email already exists" });
          continue;
        }

        const validRoles = ['admin', 'manager', 'interviewer', 'viewer'];
        const role = userData.role?.toLowerCase() || 'viewer';
        if (!validRoles.includes(role)) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
          continue;
        }

        const validStatuses = ['active', 'inactive', 'pending', 'suspended'];
        const status = userData.status?.toLowerCase() || 'active';
        if (!validStatuses.includes(status)) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
          continue;
        }

        const newUser = await UserService.createUser(
          {
            email: userData.email.trim().toLowerCase(),
            first_name: userData.first_name?.trim() || '',
            last_name: userData.last_name?.trim() || '',
            phone: userData.phone?.trim() || '',
            avatar_url: '',
            organization_id: auth.organizationId,
            role: role as any,
            status: status as any,
          },
          auth.userId
        );

        if (newUser) {
          result.success++;
          result.imported.push(newUser);
          await UserService.logUserActivity(auth.userId, "user_bulk_imported", "user", newUser.id, { email: userData.email, row: rowNumber });
        } else {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "Failed to create user" });
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

    try {
      await logActivityFromRequest(request, "users_bulk_import", {
        user_id: auth.userId,
        resource_type: "user",
        resource_id: auth.organizationId,
        details: {
          organization_id: auth.organizationId,
          total_users: usersToImport.length,
          success_count: result.success,
          failed_count: result.failed,
          import_timestamp: new Date().toISOString(),
        },
      });
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
