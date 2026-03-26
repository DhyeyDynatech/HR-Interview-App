import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { verifyToken, getUserById } from '@/lib/auth';

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

interface BulkAssigneeImportRequest {
  users: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    status?: string;
    notes?: string;
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

    const body: BulkAssigneeImportRequest = await request.json();
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

    const supabase = getSupabaseClient();

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
          result.errors.push({ row: rowNumber, email: userData.email || 'N/A', error: "Email is required" });
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "Invalid email" });
          continue;
        }

        // Check if assignee already exists in this org
        const { data: existingAssignee } = await supabase
          .from('interview_assignee')
          .select('id')
          .eq('email', userData.email)
          .eq('organization_id', auth.organizationId)
          .single();

        if (existingAssignee) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "User already exists" });
          continue;
        }

        if (!userData.first_name || !userData.first_name.trim()) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "First name missing" });
          continue;
        }

        if (!userData.last_name || !userData.last_name.trim()) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: "Last name missing" });
          continue;
        }

        const validStatuses = ['active', 'inactive', 'pending'];
        const status = userData.status?.toLowerCase() || 'active';
        if (!validStatuses.includes(status)) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: `Invalid status (use: active, inactive, pending)` });
          continue;
        }

        const { data: newAssignee, error: insertError } = await supabase
          .from('interview_assignee')
          .insert([{
            email: userData.email.trim().toLowerCase(),
            first_name: userData.first_name.trim(),
            last_name: userData.last_name.trim(),
            phone: userData.phone?.trim() || null,
            avatar_url: null,
            organization_id: auth.organizationId,
            status,
            notes: userData.notes?.trim() || null,
            interview_id: null,
          }])
          .select()
          .single();

        if (insertError || !newAssignee) {
          result.failed++;
          result.errors.push({ row: rowNumber, email: userData.email, error: insertError?.message || "Failed to create assignee" });
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

    try {
      await logActivityFromRequest(request, "assignees_bulk_import", {
        user_id: auth.userId,
        resource_type: "assignee",
        resource_id: auth.organizationId,
        details: {
          organization_id: auth.organizationId,
          total_assignees: usersToImport.length,
          success_count: result.success,
          failed_count: result.failed,
          imported_assignees: result.imported.map((a) => ({
            assignee_id: a.id,
            assignee_email: a.email,
            assignee_name: `${a.first_name} ${a.last_name}`,
            phone: a.phone || null,
            status: a.status,
          })),
          failed_imports: result.errors,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        },
      });
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
