import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServerComponent } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get user's workspaces
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  let workspaceId = memberships?.[0]?.workspace_id;

  if (!workspaceId) {
    // Create default workspace
    const { data: workspace } = await supabase
      .from("workspaces")
      .insert({
        name: "Personal",
        owner_user_id: user.id,
      })
      .select()
      .single();

    workspaceId = workspace?.id;

    await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      role: "owner",
    });
  }

  // Fetch repos
  const { data: repos } = await supabase
    .from("repos")
    .select("id,name,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen w-full bg-black">
      {/* background */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.18),transparent_55%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,0.10),transparent_55%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.06),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/70 to-black" />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold text-white/90 tracking-tight">
              Vestaryn
            </h1>
            <div className="mt-1 text-sm text-white/50">
              Select a repo or create a new one.
            </div>
            {user.email ? (
              <div className="mt-2 text-xs text-white/35 font-mono">
                Signed in as {user.email}
              </div>
            ) : null}
          </div>

          <Link
            href="/login"
            className="text-sm text-white/50 hover:text-white/80"
            title="You can log out from the repo menu in the workspace."
          >
            Account
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Create repo */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-5">
            <div className="text-xs uppercase tracking-widest text-white/40">
              Create
            </div>
            <div className="mt-1 text-white/85 font-medium">New repo</div>

            <form action="/api/repos" method="post" className="mt-4 flex gap-2">
              <input
                name="name"
                placeholder="New repo name"
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-blue-400/40"
              />
              <button className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
                Create
              </button>
            </form>

            <div className="mt-3 text-xs text-white/40">
              Tip: keep names short — you’ll see them everywhere.
            </div>
          </div>

          {/* Recent repos */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-5 min-h-[140px]">
            <div className="text-xs uppercase tracking-widest text-white/40">
              Recent
            </div>
            <div className="mt-1 text-white/85 font-medium">Repos</div>

            <div className="mt-4 space-y-2">
              {repos?.length ? (
                repos.map((repo) => (
                  <Link
                    key={repo.id}
                    href={`/repo/${repo.id}`}
                    className="group flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-white/85 truncate">
                        {repo.name || "Untitled"}
                      </div>
                      <div className="text-[10px] text-white/35 font-mono truncate">
                        {String(repo.id).slice(0, 8)}…
                      </div>
                    </div>

                    <div className="text-white/25 group-hover:text-white/50">
                      →
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-white/45">
                  No repos yet. Create your first one.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 text-[11px] text-white/30">
          Vestaryn is in active development. Expect sharp edges.
        </div>
      </div>
    </div>
  );
}