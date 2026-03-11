import { NextRequest, NextResponse } from "next/server";
import { logActivityFromRequest } from "@/lib/user-activity-log";

/**
 * API endpoint for logging export operations
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { export_type, resource_type, record_count, file_name } = body;

    if (!export_type) {
      return NextResponse.json(
        { error: "Export type is required" },
        { status: 400 }
      );
    }

    // Log export activity
    await logActivityFromRequest(
      request,
      "export_completed",
      {
        resource_type: resource_type || "assignee",
        details: {
          export_type: export_type, // e.g., "csv", "excel"
          resource_type: resource_type || "assignee",
          record_count: record_count || 0,
          file_name: file_name || null,
          export_timestamp: new Date().toISOString(),
        },
      }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error logging export:", error);
    // Don't fail the export if logging fails
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

