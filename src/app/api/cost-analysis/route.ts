import { NextRequest, NextResponse } from "next/server";
import { CostService } from "@/services/cost.service";
import { CostFilters } from "@/types/cost";

// Force dynamic rendering - this route uses request body and search params
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { organizationId, userId, filters } = body as {
      organizationId: string;
      userId?: string;
      filters?: CostFilters;
    };

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }

    const result = await CostService.getCostAnalyticsWithCategories(organizationId, filters, userId);
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
    const searchParams = req.nextUrl.searchParams;
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }

    const interviews = await CostService.getInterviewsList(organizationId);

    return NextResponse.json({ interviews }, { status: 200 });
  } catch (error) {
    console.error("Error fetching interviews list:", error);
    return NextResponse.json(
      { error: "Failed to fetch interviews list" },
      { status: 500 }
    );
  }
}
