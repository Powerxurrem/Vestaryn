import OpenAI from "openai";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const SUMMARY_KEEP_LAST = 40;
const SUMMARY_TARGET_MSGS = 200;

function clip(s: string, n = 700) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function parseMemorySections(responseText: string) {
  const sections = {
    master: "",
    chamber: "",
    tree: "",
    ledger: "",
  };

  const parts = responseText.split(/^===([A-Z]+)===/m);

  for (let i = 1; i < parts.length; i += 2) {
    const key = String(parts[i] ?? "").toLowerCase().trim();
    const content = String(parts[i + 1] ?? "").trim();

    if (key === "master") sections.master = content;
    if (key === "chamber") sections.chamber = content;
    if (key === "tree") sections.tree = content;
    if (key === "ledger") sections.ledger = content;
  }

  if (!sections.master) {
    sections.master = "# Master Summary\n\nNo summary produced.";
  }
  if (!sections.chamber) {
    sections.chamber = "# Chamber State\n\nNo chamber state produced.";
  }
  if (!sections.tree) {
    sections.tree = "# Path Tree\n\nNo path tree produced.";
  }
  if (!sections.ledger) {
    sections.ledger = "# Engineering Ledger\n\nNo ledger produced.";
  }

  return sections;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: isMember, error: memErr } = await supabase.rpc(
    "is_repo_member",
    { _repo_id: repoId }
  );

  if (memErr) {
    return new Response("Membership check failed", { status: 500 });
  }
  if (!isMember) {
    return new Response("Forbidden", { status: 403 });
  }

  const { count: beforeCount, error: beforeErr } = await supabase
    .from("repo_messages")
    .select("id", { count: "exact", head: true })
    .eq("repo_id", repoId);

  if (beforeErr) {
    return new Response(`Count failed: ${beforeErr.message}`, { status: 500 });
  }

  const { data: recent, error: recentErr } = await supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_TARGET_MSGS);

  if (recentErr) {
    return new Response(`Recent fetch failed: ${recentErr.message}`, {
      status: 500,
    });
  }

  const ordered = (recent ?? []).slice().reverse();
  const chatContext = ordered
    .map(
      (m: any) =>
        `${String(m.role).toUpperCase()}: ${clip(String(m.content ?? ""))}`
    )
    .join("\n\n");

  const nowIso = new Date().toISOString();

 const prompt = `
You are synthesizing durable memory for the Vestaryn chamber.

You are NOT chatting with a user.
You are writing internal memory files that will be used by the system itself.

You MUST output FOUR sections exactly in this order, each with its delimiter on its own line:

===MASTER===
===CHAMBER===
===TREE===
===LEDGER===

Do not omit any section.
Do not add any extra delimiter names.
Do not wrap the output in code fences.

Hard truthfulness rules:
- Use ONLY facts that are explicitly present in the provided chat history.
- NEVER invent files, routes, modules, libraries, systems, or implementation details.
- If a file/path/route is not explicitly mentioned in the chat history, do NOT include it.
- If information is missing, say "Not yet confirmed."
- Prefer omission over guessing.
- Do not rewrite the project into a generic example app.
- Preserve the actual Vestaryn context from the chat history.
- Do NOT elevate speculative suggestions into confirmed decisions.
- A design choice counts as confirmed only if the chat explicitly states it was adopted, implemented, or chosen.


Each section must contain strict markdown and must NOT reference the chat conversation directly.

SECTION DEFINITIONS

MASTER (long-term project brain)
Purpose: handover summary of the repository.

Required structure:

# Master Summary

## Current Focus
Only confirmed active engineering focus.

## Confirmed Working Systems
Only systems explicitly confirmed as working.

## Architectural Decisions
Only explicit design choices or invariants.

## Active Problems
Only real issues or risks mentioned in the chat history.

## Next Engineering Actions
Only concrete next steps explicitly discussed or strongly implied.


CHAMBER (short-term working state)
Purpose: current engineering context for the chamber.

Required structure:

# Chamber State

## Active Engineering Area
Only the confirmed subsystem currently being worked on.

## Important Files
List only files explicitly mentioned in the chat history.
If none are confirmed, write: Not yet confirmed.

## Recent Changes
Only notable recent implementation work explicitly mentioned.

## Immediate Next Steps
Only short next steps explicitly discussed.


TREE (repo structure memory)
Purpose: structural understanding of the codebase.

Required structure:

# Path Tree

Only include confirmed paths/files explicitly mentioned in the chat history.
Do NOT invent a full tree.
If the structure is incomplete, output only the confirmed partial tree.

Then include:

## Key Files
Only list confirmed files and what they do, if explicitly known.
If unknown, write: Not yet confirmed.


LEDGER (engineering timeline)
Purpose: chronological log of important development milestones.

Required structure:

# Engineering Ledger

Use this exact latest timestamp for the newest entry:
${nowIso}

Rules for ledger:
- The first entry MUST use exactly ${nowIso}
- Do NOT invent historical dates or timestamps.
- Do NOT invent milestones.
- Use only actual engineering milestones present in the chat history.
- Prefer concrete shipped/stabilized changes over discussion topics.
- Do NOT include generic research, brainstorming, or hypothetical future ideas unless they were explicitly adopted.
- Each bullet must describe an actual implementation change, fix, integration, or confirmed system behavior.
- If earlier milestones exist but exact dates are unknown, group them under:

Ledger entries must describe real engineering actions or confirmed system milestones.

Do NOT include:
- discussions
- brainstorming
- analysis of risks
- hypothetical plans

Only include:
- implemented features
- completed integrations
- added infrastructure
- stabilized systems

## Earlier Milestones
- concrete milestone
- concrete milestone

- Earlier Milestones bullets must still be concrete and specific.
- Do NOT summarize earlier milestones as broad themes like "discussion of X" or "identification of Y".
- Good milestone bullets mention real systems, routes, markers, UI panels, APIs, pruning behavior, verify behavior, vault behavior, or confirmed architectural invariants.
- If not enough concrete earlier milestones are present, output:
  ## Earlier Milestones
- Not yet confirmed.
- Each bullet must be a short engineering event.
- Prefer: "action → target".
- Avoid long sentences.

Example shape:

# Engineering Ledger

${nowIso}
- change
- change
- change

## Earlier Milestones
- older milestone
- older milestone


CHAT HISTORY
----------------
${chatContext}
`.trim();

  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    input: prompt,
    max_output_tokens: 900,
  });

  const responseText = (resp.output_text || "").trim();
  const sections = parseMemorySections(responseText);

  const nowForRows = new Date().toISOString();

  const docs = [
    {
      repo_id: repoId,
      key: "master-summary",
      content: sections.master,
      updated_at: nowForRows,
    },
    {
      repo_id: repoId,
      key: "chamber-state",
      content: sections.chamber,
      updated_at: nowForRows,
    },
    {
      repo_id: repoId,
      key: "path-tree",
      content: sections.tree,
      updated_at: nowForRows,
    },
    {
      repo_id: repoId,
      key: "ledger",
      content: sections.ledger,
      updated_at: nowForRows,
    },
  ];

  const { error: upsertErr } = await supabase
    .from("repo_memory_docs")
    .upsert(docs, { onConflict: "repo_id,key" });

  if (upsertErr) {
    return new Response(`Memory upsert failed: ${upsertErr.message}`, {
      status: 500,
    });
  }

  const { data: keepRows, error: keepErr } = await supabase
    .from("repo_messages")
    .select("id")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_KEEP_LAST);

  if (keepErr) {
    return new Response(`Keep fetch failed: ${keepErr.message}`, {
      status: 500,
    });
  }

  const keepIds = (keepRows ?? []).map((x: any) => String(x.id)).filter(Boolean);

  const supabaseAdmin = createSupabaseAdmin();
  let deleted = 0;

  if (keepIds.length > 0) {
    const { data: delRows, error: listErr } = await supabaseAdmin
      .from("repo_messages")
      .select("id")
      .eq("repo_id", repoId)
      .not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);

    if (listErr) {
      return new Response(`Delete list failed: ${listErr.message}`, {
        status: 500,
      });
    }

    const deleteIds = (delRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

    if (deleteIds.length > 0) {
      const { data: deletedRows, error: delErr } = await supabaseAdmin
        .from("repo_messages")
        .delete()
        .eq("repo_id", repoId)
        .in("id", deleteIds)
        .select("id");

      if (delErr) {
        return new Response(`Delete failed: ${delErr.message}`, {
          status: 500,
        });
      }

      deleted = deletedRows?.length ?? 0;
    }
  }

  const { count: afterCount, error: afterErr } = await supabase
    .from("repo_messages")
    .select("id", { count: "exact", head: true })
    .eq("repo_id", repoId);

  if (afterErr) {
    return new Response(`Post-count failed: ${afterErr.message}`, {
      status: 500,
    });
  }

  return Response.json({
    ok: true,
    before: Number(beforeCount ?? 0),
    after: Number(afterCount ?? 0),
    deleted,
    keys: ["master-summary", "chamber-state", "path-tree", "ledger"],
  });
}