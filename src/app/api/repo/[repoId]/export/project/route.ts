import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveTierPolicy } from "@/lib/membership/tiers";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";

export const runtime = "nodejs";

function makeJobId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await ctx.params;

  const supabase = await supabaseServerComponent();
  const admin = createSupabaseAdmin();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: repo, error: repoError } = await supabase
    .from("repos")
    .select("id, workspace_id")
    .eq("id", repoId)
    .single();

  if (repoError || !repo) {
    return new NextResponse("Repo not found", { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", repo.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const requestedTier = req.headers.get("x-vestaryn-tier");
  const isAdminAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

  const tierPolicy = resolveTierPolicy(requestedTier, {
    isAdminAllowed,
    forcedTier: "early_access",
  });

  if (!tierPolicy.capabilities.allowExport) {
    return new NextResponse(
      "Project export is not available on your tier. Upgrade to Pro.",
      { status: 403 }
    );
  }

  try {
    const snapshot = await buildRepoSnapshotSignedUrl(
      admin,
      repoId,
      makeJobId(),
      {
        signedUrlTtlSec: 600,
      }
    );

    return NextResponse.json({
      ok: true,
      repoId,
      fileCount: snapshot.fileCount,
      zipBytes: snapshot.zipBytes,
      downloadUrl: snapshot.snapshotSignedUrl,
      snapshotObjectPath: snapshot.snapshotObjectPath,
    });
  } catch (error) {
    console.error("[export_project] failed", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Project export failed",
      },
      { status: 500 }
    );
  }
}