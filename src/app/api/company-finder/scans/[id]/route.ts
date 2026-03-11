import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";
import { AggregatedCompany } from "@/types/company-finder";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;

  const user = await getUserById(userId);
  if (!user) return null;

  return { userId, organizationId: user.organization_id || user.id };
}

// GET /api/company-finder/scans/[id] - full detail for one scan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("company_finder_scan")
      .select("id, name, results, resume_names, resume_urls")
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .single();

    if (error && error.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json(
      {
        id: data.id,
        name: data.name,
        results: data.results || [],
        resumeNames: data.resume_names || [],
        resumeUrls: data.resume_urls || {},
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in GET /api/company-finder/scans/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/company-finder/scans/[id] - update results or name
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseClient();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      // Check for duplicate name within this org (excluding current scan)
      const { data: existing } = await supabase
        .from("company_finder_scan")
        .select("id")
        .eq("organization_id", auth.organizationId)
        .eq("name", body.name)
        .neq("id", id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { error: "A scan with this name already exists" },
          { status: 409 }
        );
      }

      updatePayload.name = body.name;
    }

    if (body.results !== undefined) {
      updatePayload.results = body.results;
      const results: AggregatedCompany[] = body.results || [];
      updatePayload.company_count = results.length;
    }

    if (body.resumeNames !== undefined) {
      updatePayload.resume_names = body.resumeNames;
      updatePayload.resume_count = body.resumeNames.length;
    }

    if (body.resumeUrls !== undefined) {
      updatePayload.resume_urls = body.resumeUrls;
    }

    const { error } = await supabase
      .from("company_finder_scan")
      .update(updatePayload)
      .eq("id", id)
      .eq("organization_id", auth.organizationId);

    if (error) throw error;

    return NextResponse.json({ message: "Updated" }, { status: 200 });
  } catch (error) {
    console.error("Error in PUT /api/company-finder/scans/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/company-finder/scans/[id] - remove scan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("company_finder_scan")
      .delete()
      .eq("id", id)
      .eq("organization_id", auth.organizationId);

    if (error) throw error;

    return NextResponse.json({ message: "Removed" }, { status: 200 });
  } catch (error) {
    console.error("Error in DELETE /api/company-finder/scans/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
