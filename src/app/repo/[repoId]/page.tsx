import ChamberWithVault from "@/components/ChamberWithVault";
import { supabaseServerComponent } from "../../../lib/supabase/server";
import RepoHud from "@/components/dev/RepoHud";

type Props = {
  params: Promise<{ repoId: string }>;
};

export default async function RepoPage({ params }: Props) {
  const { repoId } = await params;

  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <div className="p-8">Not authenticated</div>;

  const { data: repo, error } = await supabase
    .from("repos")
    .select("id, name")
    .eq("id", repoId)
    .single();

  if (error || !repo) return <div className="p-8">Repo not found</div>;

  return (
    
    <div className="p-8 space-y-10">
      <div className="relative pt-20">
  <RepoHud repoId={repoId} repoName={null} />
  {/* existing layout */}
</div>
      <ChamberWithVault repoId={repoId} />
    </div>
  );
}
