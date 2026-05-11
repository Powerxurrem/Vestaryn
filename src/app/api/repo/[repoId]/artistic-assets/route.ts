import { supabaseRouteHandler } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "repo-artistic-assets";

async function requireRepoMember(repoId: string) {
  const supabase = await supabaseRouteHandler();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      error: new Response("Unauthorized", { status: 401 }),
    };
  }

  const { data: isMember, error } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  if (error) {
    console.error("[artistic-assets] membership check failed", error);
    return {
      supabase,
      user,
      error: new Response("Membership check failed", { status: 500 }),
    };
  }

  if (!isMember) {
    return {
      supabase,
      user,
      error: new Response("Forbidden", { status: 403 }),
    };
  }

  return {
    supabase,
    user,
    error: null,
  };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Expected a base64 data URL image.");
  }

  const mimeType = match[1] || "image/png";
  const base64 = match[2] || "";
  const buffer = Buffer.from(base64, "base64");

  return {
    mimeType,
    buffer,
  };
}

function mimeToExtension(mimeType: string) {
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}

export async function POST(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  try {
    const { repoId } = await context.params;

    const guard = await requireRepoMember(repoId);
    if (guard.error) return guard.error;

    const body = await req.json().catch(() => null);

    const dataUrl = body?.dataUrl;
    const kind = String(body?.kind ?? "image");

    if (!dataUrl || typeof dataUrl !== "string") {
      return Response.json({ error: "Missing dataUrl" }, { status: 400 });
    }

    if (!dataUrl.startsWith("data:image/")) {
      return Response.json(
        { error: "Only image data URLs are supported." },
        { status: 400 }
      );
    }

    const { mimeType, buffer } = parseDataUrl(dataUrl);
    const ext = mimeToExtension(mimeType);
    const assetId = crypto.randomUUID();

    const safeKind =
      kind === "processed" || kind === "generated" ? kind : "image";

    const storagePath = `${repoId}/artistic/${safeKind}-${assetId}.${ext}`;

    const { error: uploadError } = await guard.supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[artistic-assets] upload failed", uploadError);
      return new Response("Failed to upload artistic asset.", { status: 500 });
    }

    const { data: signed, error: signedError } = await guard.supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 60);

    if (signedError || !signed?.signedUrl) {
      console.error("[artistic-assets] signed url failed", signedError);
      return new Response("Failed to sign artistic asset.", { status: 500 });
    }

    return Response.json({
      ok: true,
      storagePath,
      signedUrl: signed.signedUrl,
    });
  } catch (err: any) {
    console.error("[artistic-assets] failed", err);

    return new Response(
      err?.message || "Artistic asset upload failed.",
      { status: 500 }
    );
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  try {
    const { repoId } = await context.params;

    const guard = await requireRepoMember(repoId);
    if (guard.error) return guard.error;

    const body = await req.json().catch(() => null);
    const storagePaths = Array.isArray(body?.storagePaths)
      ? body.storagePaths
      : [];

    const safePaths = storagePaths
      .map((path: unknown) => String(path ?? "").trim())
      .filter(Boolean)
      .filter((path: string) => path.startsWith(`${repoId}/artistic/`));

    if (safePaths.length === 0) {
      return Response.json({ signedUrls: {} });
    }

    const signedUrls: Record<string, string> = {};

    for (const path of safePaths) {
      const { data, error } = await guard.supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60);

      if (!error && data?.signedUrl) {
        signedUrls[path] = data.signedUrl;
      }
    }

    return Response.json({
      signedUrls,
    });
  } catch (err: any) {
    console.error("[artistic-assets] refresh failed", err);

    return new Response(
      err?.message || "Failed to refresh artistic asset URLs.",
      { status: 500 }
    );
  }
}