import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { buildRepoSnapshotSignedUrl } from "@/lib/runner/snapshot";
import { runnerRun } from "@/lib/runner/client";
import { VAULT_BUCKET } from "@/lib/vault/buckets";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ repoId: string; fileId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  const supabase = await supabaseServerComponent();
  const admin = createSupabaseAdmin();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: isMember, error: memErr } = await supabase.rpc(
    "is_repo_member",
    { _repo_id: repoId }
  );

  if (memErr) {
    return NextResponse.json({ error: "Membership check failed" }, { status: 500 });
  }

  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: file, error: fileErr } = await supabase
    .from("repo_files")
    .select("id, path, name, mime, deleted_at")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fileErr || !file) {
    return NextResponse.json({ error: fileErr?.message ?? "File not found" }, { status: 404 });
  }

  if (!/\.py$/i.test(String(file.path ?? ""))) {
    return NextResponse.json({ error: "Only .py files are supported for Execute & Download" }, { status: 400 });
  }

  const jobId = `execute-download-${repoId}-${Date.now()}`;
  const snap = await buildRepoSnapshotSignedUrl(admin, repoId, jobId, {
    signedUrlTtlSec: 600,
  });

  const result = await runnerRun({
    jobId,
    commandId: "python_execute_artifact",
    snapshotUrl: snap.snapshotSignedUrl,
    timeoutMs: 120_000,
  });

    console.log("[execute_download runner result]", {
      ok: result.ok,
      exitCode: result.exitCode,
      failedStep: result.failedStep ?? null,
      failureKind: result.failureKind ?? null,
      hasArtifactPreview: !!result.artifactPreview,
      hasArtifactFile: !!result.artifactFile,
      artifactFileMeta: result.artifactFile
        ? {
            path: result.artifactFile.path,
            filename: result.artifactFile.filename,
            mime: result.artifactFile.mime,
            bytes: result.artifactFile.bytes,
            hasBase64:
              typeof result.artifactFile.base64 === "string" &&
              result.artifactFile.base64.length > 0,
          }
        : null,
      stdoutHead: String(result.stdout ?? "").slice(0, 400),
      stderrHead: String(result.stderr ?? "").slice(0, 400),
    });

  if (!result.ok || !result.artifactFile?.base64) {
    return NextResponse.json(
      {
        error:
          result.error ||
          (!result.artifactFile?.base64
            ? "Artifact execution completed but no downloadable file was returned"
            : "Artifact execution failed"),
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        failureKind: result.failureKind ?? null,
      },
      { status: 400 }
    );
  }

  const artifactBuf = Buffer.from(result.artifactFile.base64, "base64");
  const filename = result.artifactFile.filename || "artifact.xlsx";
  const objectPath = `artifacts/${repoId}/${Date.now()}-${crypto.randomUUID()}-${filename}`;

  const up = await admin.storage.from(VAULT_BUCKET).upload(objectPath, artifactBuf, {
    contentType:
      result.artifactFile.mime ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: false,
  });

  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 500 });
  }

  const signed = await admin.storage.from(VAULT_BUCKET).createSignedUrl(objectPath, 60 * 10);

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { error: signed.error?.message ?? "Failed to create signed URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    filename,
    downloadUrl: signed.data.signedUrl,
    bytes: artifactBuf.byteLength,
  });
}