import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const form = await req.formData();
  const name = String(form.get("name") || "").trim();

  if (!name) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // find membership
  const { data: memberships, error: memErr } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  if (memErr) {
    return NextResponse.json({ where: "membership_select", error: memErr.message }, { status: 400 });
  }

  const workspaceId = memberships?.[0]?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json({ where: "membership_missing", error: "No workspace membership found" }, { status: 400 });
  }

  const { error: insErr } = await supabase.from("repos").insert({
    workspace_id: workspaceId,
    name,
  });

  if (insErr) {
    return NextResponse.json({ where: "repo_insert", error: insErr.message }, { status: 400 });
  }

  return NextResponse.redirect(new URL("/", req.url));
}
