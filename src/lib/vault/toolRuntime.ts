import {
  vault_list_files,vault_read_text,vault_propose_write,vault_propose_append,vault_propose_create,vault_apply_write,vault_apply_create,resolveFileIdByPathOrName
} from "@/lib/vault/tools";

import { inferTextMimeFromPath} from "@/lib/vault/utils";

export const TOOLS: any[] = [
  {
    type: "function",
    name: "vault_list_files",
    description:
      "List vault files for this repo. Returns { files: [{id,path,name,mime,updated_at,created_at,size_bytes}] }.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "vault_read_text",
    description:
      "Read a small text file from the vault. Accepts fileId (UUID). If only a filename or path is provided, it will be resolved automatically.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        path: { type: "string" },
        name: { type: "string" },
      },
      additionalProperties: false,
    },
  },
{
  type: "function",
  name: "vault_propose_write",
  description:
    "Propose overwriting an EXISTING text file with new content. Does NOT write. Accepts either fileId or path/name. Returns hashes and a confirmation phrase.",
  parameters: {
    type: "object",
    properties: {
      fileId: { type: "string", description: "UUID of the file if known" },
      path: { type: "string", description: "Existing file path or name, e.g. app/layout.tsx" },
      content: { type: "string", description: "Full rewritten file content" },
    },
    required: ["content"],
    additionalProperties: false,
  },
},
{
  type: "function",
  name: "vault_propose_create",
  description:
    "Propose creating a NEW text file at a given path with content. Does NOT write. Returns hashes and a confirmation phrase.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "New file path (must not already exist), e.g. app/pomodoro/page.tsx" },
      content: { type: "string", description: "Full initial contents of the new file" },
      mime: { type: "string", description: "Optional mime (defaults to text/plain)" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
},
  {
    type: "function",
    name: "vault_propose_append",
    description:
      "Propose appending text to an existing text file. Does NOT write. Returns hashes and a confirmation phrase.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "UUID of the file (preferred if known)" },
        path: { type: "string", description: "File path or name, e.g. pikachu.txt" },
        content: { type: "string", description: "Text to append" },
      },
      required: ["content", "path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "vault_apply_write",
    description:
      "Apply a previously proposed overwrite to a text file by creating a new version vN. Requires exact user confirmation phrase.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        content: { type: "string" },
        prevHash: { type: "string" },
        nextHash: { type: "string" },
        confirm: { type: "string" },
      },
      required: ["fileId", "content", "prevHash", "nextHash", "confirm"],
      additionalProperties: false,
    },
  },
  {
  type: "function",
  name: "vault_apply_create",
  description:
    "Apply a previously proposed create by writing v1, inserting repo_files + repo_file_versions. Requires exact user confirmation phrase.",
  parameters: {
    type: "object",
    properties: {
      fileId: { type: "string" },
      path: { type: "string" },
      name: { type: "string" },
      mime: { type: "string" },
      content: { type: "string" },
      prevHash: { type: "string" },
      nextHash: { type: "string" },
      confirm: { type: "string" },
      meta: {},
    },
    required: ["fileId", "path", "mime", "content", "prevHash", "nextHash", "confirm"],
    additionalProperties: false,
  },
},
];

export async function runTool(
  supabase: any,
  repoId: string,
  userId: string,
  userMessage: string,
  name: string,
  args: any,
  
) {
  const ts = new Date().toISOString();

  try {
    if (name === "vault_list_files") {
      const result = await vault_list_files(supabase, repoId);
      console.log("[tool]", ts, name, { ok: true, count: result.files?.length ?? 0 });
      return result;
    }

    if (name === "vault_read_text") {
      if (!args || (args.fileId == null && args.path == null && args.name == null)) {
        throw new Error("vault_read_text missing args: provide fileId OR path OR name");
      }

      const rawFileId = String(args?.fileId || "").trim();
      const rawPath = String(args?.path || "").trim();
      const rawName = String(args?.name || "").trim();

      const looksUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawFileId);

      let fileRef = "";

      // Prefer stable repository identifiers over hallucinated UUIDs.
      if (rawPath) {
        fileRef = rawPath;
      } else if (rawName) {
        fileRef = rawName;
      } else if (looksUuid) {
        fileRef = rawFileId;
      } else if (rawFileId) {
        fileRef = rawFileId;
      } else {
        throw new Error("vault_read_text missing usable identifier");
      }

      const result = await vault_read_text(supabase, repoId, fileRef);
      console.log("[tool]", ts, name, {
        ok: true,
        fileRef,
        via: rawPath ? "path" : rawName ? "name" : "fileId",
      });
      return result;
    }

    if (name === "vault_propose_write") {
      const content = String(args?.content ?? "");
      if (!content) throw new Error("vault_propose_write missing content");

      const path = String(args?.path ?? "").trim();
      let fileId = String(args?.fileId ?? "").trim();

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId);

      if (!isUuid) {
        const needle = path || fileId;
        if (!needle) throw new Error("vault_propose_write missing fileId/path");

        const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, needle);

        // 🔥 Fallback: model asked for write on a file that doesn't exist yet.
        // If a path is present, treat it as create instead of failing.
        if (!resolvedId) {
          if (path) {
            const created = await vault_propose_create(supabase, repoId, {
              path,
              content,
              mime: inferTextMimeFromPath(path),
            });

            console.log("[tool]", ts, name, {
              ok: true,
              fallback: "create",
              path,
              fileId: created.fileId,
            });

            return created;
          }

          throw new Error(`File not found by path/name: ${needle}`);
        }

        fileId = resolvedId;
      } else {
        if (path) {
          const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, path);

          if (!resolvedId) {
            const created = await vault_propose_create(supabase, repoId, {
              path,
              content,
              mime: "application/javascript",
            });

            console.log("[tool]", ts, name, {
              ok: true,
              fallback: "create",
              path,
              fileId: created.fileId,
            });

            return created;
          }

          if (resolvedId && resolvedId !== fileId) {
            console.log("[vault_propose_write] ignoring mismatched fileId, using path", {
              fileId,
              resolvedId,
              path,
            });
            fileId = resolvedId;
          }
        }
      }

      try {
        const result = await vault_propose_write(supabase, repoId, fileId, content);
        console.log("[tool]", ts, name, { ok: true, fileId });
        return result;
      } catch (e: any) {
        if (e?.message === "__NOOP_PROPOSAL__") {
          console.log("[tool]", ts, name, { ok: true, fileId, noop: true });
          return {
            noop: true,
            code: "NO_CHANGE_NEEDED",
            fileId,
          };
        }
        throw e;
      }
    }
    
    if (name === "vault_apply_create") {
      const payload = {
        fileId: String(args?.fileId ?? "").trim(),
        path: String(args?.path ?? "").trim(),
        name: args?.name ? String(args.name) : undefined,
        mime: String(args?.mime ?? "text/plain"),
        content: String(args?.content ?? ""),
        prevHash: String(args?.prevHash ?? ""),
        nextHash: String(args?.nextHash ?? ""),
        confirm: String(args?.confirm ?? ""),
        meta: args?.meta ?? null,
        baseline: false,
      };

      if (!payload.path) throw new Error("vault_apply_create missing path");
      if (!payload.content) throw new Error("vault_apply_create missing content");
      if (!payload.prevHash) throw new Error("vault_apply_create missing prevHash");
      if (!payload.nextHash) throw new Error("vault_apply_create missing nextHash");
      if (!payload.confirm) throw new Error("vault_apply_create missing confirm");

      const result = await vault_apply_create(supabase, repoId, userId, payload.confirm, payload);
      console.log("[tool]", ts, name, { ok: true, path: payload.path, fileId: payload.fileId });
      return result;
    }

    if (name === "vault_propose_create") {
      const path = String(args?.path ?? "").trim();
      const content = String(args?.content ?? "");
      const rawMime = String(args?.mime ?? "").trim();
      const mime =
        !rawMime || rawMime === "text/plain"
          ? inferTextMimeFromPath(path)
          : rawMime;

      const result = await vault_propose_create(supabase, repoId, { path, content, mime });
      console.log("[tool]", ts, name, { ok: true, path: result.path, fileId: result.fileId });
      return result;
    }

    if (name === "vault_propose_append") {
      const content = String(args?.content ?? "");
      if (!content) throw new Error("vault_propose_append missing content");

      const path = String(args?.path ?? "").trim();
      const fileId = String(args?.fileId ?? "").trim();

      const fileRef = path || fileId;
      if (!fileRef) throw new Error("vault_propose_append missing fileId/path");

      const result = await vault_propose_append(supabase, repoId, fileRef, content);
      console.log("[tool]", ts, name, { ok: true, fileRef });
      return result;
    }

    if (name === "vault_apply_write") {
      let fileId = String(args?.fileId ?? "").trim();
      const path = String(args?.path ?? "").trim();

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId);

      if (!isUuid) {
        const needle = (path || fileId).trim();
        if (!needle) throw new Error("vault_apply_write missing fileId/path");

        const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, needle);
        if (!resolvedId) throw new Error(`File not found by path/name: ${needle}`);

        fileId = resolvedId;
      } else {
        if (path) {
          const resolvedId = await resolveFileIdByPathOrName(supabase, repoId, path);
          if (resolvedId && resolvedId !== fileId) {
            throw new Error(`vault_apply_write mismatch: fileId does not match path (${path})`);
          }
        }
      }

      const payload = {
        fileId,
        content: String(args?.content ?? ""),
        prevHash: String(args?.prevHash ?? ""),
        nextHash: String(args?.nextHash ?? ""),
        confirm: String(args?.confirm ?? ""),
      };

      if (!payload.content) throw new Error("vault_apply_write missing content");
      if (!payload.prevHash) throw new Error("vault_apply_write missing prevHash");
      if (!payload.nextHash) throw new Error("vault_apply_write missing nextHash");
      if (!payload.confirm) throw new Error("vault_apply_write missing confirm");

      const result = await vault_apply_write(supabase, repoId, userId, payload.confirm, payload);
      console.log("[tool]", ts, name, { ok: true, fileId: payload.fileId });
      return result;
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (e: any) {
    console.log("[tool]", ts, name, { ok: false, error: e?.message });
    return { error: e?.message || "Tool failed" };
  }
}