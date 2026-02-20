import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
