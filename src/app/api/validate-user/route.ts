import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: NextRequest) {
  try {
    const { email, interview_id } = await req.json();
    console.log("Received email:", email, interview_id);
    if (!email) {

      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("interview_assignee")
      .select("id, allow_retake")
      .ilike("email", email)
      .eq("interview_id", interview_id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "You are not authorized person" },
        { status: 401 }
      );
    }

    // Server-side retake check — block if allow_retake is explicitly false
    if (data.allow_retake === false) {
      return NextResponse.json(
        { error: "You have already completed this interview. Please contact your recruiter if you need another attempt." },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("Server error:", err);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}