import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { getRepoFileStatuses } from "@/lib/vault/fileStatus";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: isMember, error: memErr } = await supabase.rpc(
    "is_repo_member",
    { _repo_id: repoId }
  );

  if (memErr) {
    return new NextResponse("Membership check failed", { status: 500 });
  }

  if (!isMember) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const statuses = await getRepoFileStatuses(repoId);

  return NextResponse.json({
    ok: true,
    repoId,
    statuses,
  });
}