import { NextRequest, NextResponse } from "next/server";
import { CostService } from "@/services/cost.service";
import { CostFilters } from "@/types/cost";
import { verifyToken, getUserById } from "@/lib/auth";

// Force dynamic rendering - this route uses request body and search params
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  try {
    const auth = await extractAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { filters } = body as { filters?: CostFilters };

    const result = await CostService.getCostAnalyticsWithCategories(auth.organizationId, filters, auth.userId);
    return NextResponse.json({ ...result, dataSource: "tracked" }, { status: 200 });
  } catch (error) {
    console.error("Error in cost analysis API:", error);

    return NextResponse.json(
      { error: "Failed to fetch cost analysis" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await extractAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const interviews = await CostService.getInterviewsList(auth.organizationId);

    return NextResponse.json({ interviews }, { status: 200 });
  } catch (error) {
    console.error("Error fetching interviews list:", error);
    return NextResponse.json(
      { error: "Failed to fetch interviews list" },
      { status: 500 }
    );
  }
}
