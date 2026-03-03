import ChamberWithVault from "@/components/ChamberWithVault";
import { supabaseServerComponent } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ repoId: string }>;
};

export default async function RepoPage({ params }: Props) {
  const { repoId } = await params;

  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div className="p-8">Not authenticated</div>;

  const { data: repo, error } = await supabase
    .from("repos")
    .select("id, name")
    .eq("id", repoId)
    .single();

  if (error || !repo) return <div className="p-8">Repo not found</div>;

  return (
    <div className="h-[calc(100vh-0px)] w-full">
      {/* ChamberWithVault/VestarynFrame handles the header */}
      <div className="h-full min-h-0">
        <ChamberWithVault repoId={repoId} repoName={repo.name} />
      </div>
    </div>
  );
}