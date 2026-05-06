import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});



export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt?.trim()) {
      return Response.json({ error: "Missing prompt" }, { status: 400 });
    }

    const safePrompt = `
    professional presentation illustration,
    clean composition,
    high quality,
    modern visual style,

    Rules:
    - no people
    - no faces
    - no text
    - no letters
    - no logos
    - no watermarks

    User request:
    ${prompt.trim()}
    `.trim();

       const result = await openai.images.generate({
      model: "gpt-image-1-mini",
      prompt: safePrompt,
      size: "1024x1024",
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