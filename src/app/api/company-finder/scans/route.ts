import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

// GET /api/company-finder/scans - list all scans for the user's org
export async function GET(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("company_finder_scan")
      .select("id, name, company_count, resume_count, created_at")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const scans = (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      companyCount: row.company_count || 0,
      resumeCount: row.resume_count || 0,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ scans }, { status: 200 });
  } catch (error) {
    console.error("Error in GET /api/company-finder/scans:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/company-finder/scans - create a new scan
export async function POST(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await request.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Scan name is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Check for duplicate name within this org
    const { data: existing } = await supabase
      .from("company_finder_scan")
      .select("id")
      .eq("organization_id", auth.organizationId)
      .eq("name", name.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "A scan with this name already exists" },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("company_finder_scan")
      .insert({
        organization_id: auth.organizationId,
        name: name.trim(),
      })
      .select("id, name")
      .single();

    if (error) throw error;

    return NextResponse.json(
      { id: data.id, name: data.name },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in POST /api/company-finder/scans:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
