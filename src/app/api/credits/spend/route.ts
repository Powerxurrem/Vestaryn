import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await supabaseRouteHandler();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount ?? 0);
  const reason = String(body.reason ?? "unknown");
  const meta = body.meta ?? {};

  if (!Number.isFinite(amount) || amount <= 0)
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

  const { data, error } = await supabase.rpc("spend_credits", {
    p_user_id: user.id,
    p_amount: Math.floor(amount),
    p_reason: reason,
    p_meta: meta,
  });

  if (error)
    return NextResponse.json(
      { error: error.message.includes("insufficient") ? "Insufficient credits" : error.message },
      { status: 400 }
    );

  return NextResponse.json({ balance: data });
}