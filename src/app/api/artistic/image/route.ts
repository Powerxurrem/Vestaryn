import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function resolveImageSize(imageAspect: string | undefined) {
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

function buildSafePrompt(args: {
  prompt: string;
  imageMode?: string;
}) {
  const baseRules = `
Rules:
- no text
- no letters
- no logos
- no watermarks
`.trim();

  if (args.imageMode === "book_background") {
    return `
children's book background illustration,
warm storybook atmosphere,
soft painterly detail,
child-friendly,
environment only,

${baseRules}
- no people
- no faces
- no characters
- background only

User request:
${args.prompt.trim()}
`.trim();
  }

  if (args.imageMode === "book_character") {
    return `
children's book character illustration,
single reusable character,
warm storybook design,
simple clean background,
child-friendly,

${baseRules}

User request:
${args.prompt.trim()}
`.trim();
  }

  if (args.imageMode === "print_illustration") {
    return `
children's book print illustration,
polished storybook artwork,
warm readable composition,
child-friendly,
print page style,

${baseRules}

User request:
${args.prompt.trim()}
`.trim();
  }

  return `
professional presentation illustration,
clean composition,
high quality,
modern visual style,

${baseRules}
- no people
- no faces

User request:
${args.prompt.trim()}
`.trim();
}

export async function POST(req: Request) {
  try {
    const { prompt, imageMode, imageAspect } = await req.json();

    if (!prompt?.trim()) {
      return Response.json({ error: "Missing prompt" }, { status: 400 });
    }

    const safePrompt = buildSafePrompt({
      prompt,
      imageMode,
    });

const size = resolveImageSize(imageAspect);

       const result = await openai.images.generate({
      model: "gpt-image-1-mini",
      prompt: safePrompt,
      size,
    });


    
    const imageBase64 = result.data?.[0]?.b64_json;
    const imageUrl = result.data?.[0]?.url;

    if (!imageBase64 && !imageUrl) {
      console.error("[artistic/image] no image returned", result);
      return new Response("No image data returned from OpenAI.", {
        status: 502,
      });
    }

    return Response.json({
      imageUrl: imageBase64
        ? `data:image/png;base64,${imageBase64}`
        : imageUrl,
    });


    
  } catch (err: any) {
    console.error("[artistic/image] generation failed", {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      type: err?.type,
      name: err?.name,
      error: err,
    });

    return new Response(
      err?.message || "Image generation failed on the server.",
      { status: err?.status || 500 }
    );
  }
}