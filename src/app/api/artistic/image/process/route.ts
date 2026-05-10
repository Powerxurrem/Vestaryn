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
    const { imageUrl, operation, adjustments } = await req.json();

    if (!imageUrl || typeof imageUrl !== "string") {
      return Response.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    if (operation !== "remove_background") {
      return Response.json({ error: "Unsupported operation" }, { status: 400 });
    }

    if (!imageUrl.startsWith("data:image/")) {
      return Response.json(
        {
          error:
            "Only data URL images are supported for this first processor version.",
        },
        { status: 400 }
      );
    }

    const { mimeType, buffer } = parseDataUrl(imageUrl);
    const ext = mimeToExtension(mimeType);

    const inputFile = new File([buffer], `input.${ext}`, {
      type: mimeType,
    });

    const result = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_PROCESS_MODEL || "gpt-image-1",
      image: inputFile,
      prompt: `
Remove the background completely.

Preserve only the main subject.
Keep the subject's shape, colors, costume, expression, and style.
Do not add text, letters, logos, borders, captions, or watermarks.
Return a clean cutout PNG with a transparent background.

If the subject is a children's book character, keep it suitable as a reusable storybook sticker asset.
`.trim(),
      size: "1024x1024",
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