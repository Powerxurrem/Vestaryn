import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 90;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function POST(req: Request) {
  try {
    const { imageUrl, operation, adjustments, imageAspect } = await req.json();

    if (!imageUrl || typeof imageUrl !== "string") {
      return Response.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    if (operation !== "remove_background") {
      return Response.json({ error: "Unsupported operation" }, { status: 400 });
    }

    let mimeType = "image/png";
let buffer: Buffer;

if (imageUrl.startsWith("data:image/")) {
  const parsed = parseDataUrl(imageUrl);
  mimeType = parsed.mimeType;
  buffer = parsed.buffer;
} else if (/^https?:\/\//i.test(imageUrl)) {
  const imageRes = await fetch(imageUrl);

  if (!imageRes.ok) {
    return Response.json(
      { error: `Failed to fetch source image (${imageRes.status})` },
      { status: 400 }
    );
  }

  const contentType = imageRes.headers.get("content-type") || "image/png";

  if (!contentType.startsWith("image/")) {
    return Response.json(
      { error: "Source URL did not return an image." },
      { status: 400 }
    );
  }

  mimeType = contentType;
  buffer = Buffer.from(await imageRes.arrayBuffer());
} else {
  return Response.json(
    { error: "Unsupported imageUrl. Expected data URL or http(s) image URL." },
    { status: 400 }
  );
}

function resolveProcessSize(imageAspect: string | undefined) {
  switch (imageAspect) {
    case "portrait":
      return "1024x1536" as const;
    case "landscape":
      return "1536x1024" as const;
    case "square":
    default:
      return "1024x1024" as const;
  }
}

const ext = mimeToExtension(mimeType);

const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength
) as ArrayBuffer;

const inputFile = new File([arrayBuffer], `input.${ext}`, {
  type: mimeType,
});

    const result = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_PROCESS_MODEL || "gpt-image-1",
      image: inputFile,
      prompt: `
        Remove the background completely.

        Preserve the entire original subject from head to toe.
        Do not crop any part of the subject.
        Keep all limbs, feet, armor, clothing, silhouette edges, and small details visible.
        Keep the subject's shape, colors, costume, expression, and style.
        Place the full subject centered on a transparent canvas with generous transparent padding around it.

        Do not zoom in.
        Do not reframe tightly.
        Do not cut off the feet, hands, helmet, hair, clothing, or object edges.
        Do not add text, letters, logos, borders, captions, or watermarks.

        Return a clean cutout PNG with a transparent background.

        If the subject is a children's book character, keep it suitable as a reusable storybook sticker asset.
        `.trim(),
      size: resolveProcessSize(imageAspect),
      background: "transparent",
      output_format: "png",
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      console.error("[artistic/image/process] no processed image returned", result);
      return new Response("No processed image data returned.", {
        status: 502,
      });
    }

    return Response.json({
      processedImageUrl: `data:image/png;base64,${imageBase64}`,
      operation,
      adjustments: adjustments ?? null,
    });
  } catch (err: any) {
    console.error("[artistic/image/process] failed", {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      type: err?.type,
      name: err?.name,
      error: err,
    });

    return new Response(
      err?.message || "Image processing failed on the server.",
      { status: err?.status || 500 }
    );
  }
}