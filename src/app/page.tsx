import { redirect } from "next/navigation";
import { supabaseServerComponent } from "@/lib/supabase/server";
import Link from "next/link";

export default async function Home() {
  const supabase = await supabaseServerComponent();


  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
    .select("id,name")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Vestaryn</h1>

      <form action="/api/repos" method="post" className="flex gap-2">
        <input
          name="name"
          placeholder="New repo name"
          className="border px-3 py-2 rounded"
        />
        <button className="border px-3 py-2 rounded">
          Create
        </button>
      </form>

      <div className="space-y-2">
        {repos?.map((repo) => (
          <div key={repo.id} className="border p-3 rounded">
            <Link href={`/repo/${repo.id}`} className="underline">
              {repo.name}
            </Link>
          </div>
        ))}
      </div>

    </div>
  );
}
