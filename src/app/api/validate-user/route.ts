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
      .select("id")
      .ilike("email", email)
      .eq("interview_id", interview_id)
      .single();
    console.log("Supabase data:", data, "error:", error); 
    if (error || !data) {

      return NextResponse.json(
        { error: "You are not authorized person" },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("Server error:", err);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}