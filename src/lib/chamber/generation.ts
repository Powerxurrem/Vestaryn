import OpenAI from "openai";
import { stripCodeFences } from "@/lib/vault/utils";

export async function generateSplitFileContents(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  sourcePath: string;
  sourceContent: string;
  targetPaths: string[];
}) {
  const prompt = `
You are splitting one repository file into multiple files.

Return ONLY valid JSON in this exact shape:
{
  "files": [
    { "path": "target/path.ext", "content": "full file content" }
  ]
}

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include any text before or after the JSON.
- Produce one entry for each requested target path.
- Preserve valid syntax.
- The result should satisfy the user's split request.

Source file:
${opts.sourcePath}

Requested target paths:
${opts.targetPaths.map((p) => `- ${p}`).join("\n")}

User request:
${opts.userRequest}

Source content:
<<<FILE
${opts.sourceContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 3200,
  });

  const raw = (resp.output_text || "").trim();
  console.log("[extract_orchestration raw]", raw.slice(0, 4000));

  const cleaned = stripCodeFences(raw).trim();
  console.log("[extract_orchestration cleaned]", cleaned.slice(0, 4000));

  let parsed: any;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      throw new Error(`extract JSON parse failed: ${e?.message ?? "unknown parse error"}`);
    }
  
  const files = Array.isArray(parsed?.files) ? parsed.files : [];

  return files
    .filter((f: any) => typeof f?.path === "string" && typeof f?.content === "string")
    .map((f: any) => ({
      path: String(f.path).trim(),
      content: String(f.content),
    }));
}

export async function generateExtractHelpersResult(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  sourcePath: string;
  sourceContent: string;
  targetPath: string;
}) {
  const prompt = `
You are extracting pure helper functions from one repository file into a separate module.

Return ONLY valid JSON in this exact shape:
{
  "targetContent": "full contents of the new helper module",
  "sourceContent": "full rewritten contents of the original source file"
}

Hard rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include any text before or after the JSON.
- sourceContent must be the FULL rewritten contents of the original source file.
- targetContent must be the FULL contents of the new helper module.
- Do not use placeholders.
- Do not use ellipses.
- Do not use comments like:
  - "rest of file unchanged"
  - "other code remains unchanged"
  - "..."
  - "omitted"
  - "the rest of the file"
- Do not return partial files.
- Do not shorten the source file by summarizing unchanged sections.
- Preserve runtime behavior.
- Move only pure helper functions and intent-detection helpers.
- Do not move route handlers, streaming logic, Supabase calls, OpenAI calls, verification functions, vault_* functions, or command-handling branches.
- Keep all non-extracted logic in sourceContent.
- Update imports in sourceContent so it compiles.
- Use the import path "@/lib/chamber/chatIntent" from the source file.
- Keep function names unchanged unless absolutely necessary.
- If you cannot produce a complete valid extraction, return this exact JSON:
  {"targetContent":"","sourceContent":""}

Source file:
${opts.sourcePath}

Target helper module:
${opts.targetPath}

User request:
${opts.userRequest}

Source content:
<<<FILE
${opts.sourceContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 5200,
  });

  const raw = resp.output_text ?? "";
  const jsonText = extractJsonObject(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`Model returned invalid JSON: ${e?.message ?? "unknown parse error"}`);
  }

function extractJsonObject(text: string) {
  const s = String(text ?? "").trim();

  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fenced?.[1]?.trim() ?? s;

  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output");
  }

  return unfenced.slice(first, last + 1);
}

  return {
    targetContent: String(parsed?.targetContent ?? ""),
    sourceContent: String(parsed?.sourceContent ?? ""),
  };
}

export async function generateNewFileContent(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
}) {
  const prompt = `
You are creating a NEW repository file.

Return ONLY the full file contents.

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include [Observation]/[Assessment]/[Action].
- Do not include JSON.
- Produce valid code/content for the target path.

Target file: ${opts.path}

User request:
${opts.userRequest}
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 3200,
  });

  return (resp.output_text || "").trim();
}

export async function generateRewrittenFileContent(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  currentContent: string;
}) {
  const prompt = `
You are rewriting an existing repository file.

Return ONLY the full rewritten file content.

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include [Observation]/[Assessment]/[Action].
- Do not include JSON.
- Preserve valid syntax.

Target file: ${opts.path}

User request:
${opts.userRequest}

Current file content:
<<<FILE
${opts.currentContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 3200,
  });

  return (resp.output_text || "").trim();
}