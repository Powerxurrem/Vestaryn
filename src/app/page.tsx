import Link from "next/link";
import { supabaseServerComponent } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ waitlist?: string | string[] }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawWaitlist = resolvedSearchParams?.waitlist;
  const waitlistState = Array.isArray(rawWaitlist) ? rawWaitlist[0] : rawWaitlist ?? null;

  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let workspaceId: string | null = null;
  let repos:
    | Array<{
        id: string;
        name: string | null;
        created_at: string;
      }>
    | null = null;

  if (user) {
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1);

    workspaceId = memberships?.[0]?.workspace_id ?? null;

    if (!workspaceId) {
      const { data: workspace } = await supabase
        .from("workspaces")
        .insert({
          name: "Personal",
          owner_user_id: user.id,
        })
        .select()
        .single();

      workspaceId = workspace?.id ?? null;

      if (workspaceId) {
        await supabase.from("workspace_members").insert({
          workspace_id: workspaceId,
          user_id: user.id,
          role: "owner",
        });
      }
    }

    if (workspaceId) {
      const { data } = await supabase
        .from("repos")
        .select("id,name,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);

      repos = data;
    }
  }

  return (
    <div className="min-h-screen w-full bg-black text-white">
      {/* chamber background */}
      <div className="pointer-events-none fixed inset-0 -z-0">
        {/* banner image */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-60"
          style={{
            backgroundImage: "url('/vestaryn_chamber.jpg')",
          }}
        />

        {/* dark readability gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />

        {/* subtle Vestaryn blue glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.25),transparent_50%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,0.15),transparent_50%)] opacity-70" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 md:px-8 md:py-10">
        {/* chamber energy glow */}
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-40">
          <div className="absolute left-1/2 top-40 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-[160px]" />
        </div>

        {/* hero */}
        <section className="pt-20 pb-12 md:pt-28 md:pb-16">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white/50">
              Early Access
            </div>

            <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-white/95 sm:text-5xl md:text-6xl">
              An AI development chamber for controlled code change.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/62 sm:text-lg">
              Vestaryn stages code changes, previews repository edits, and
              verifies before apply so mutation stays controlled instead of
              blind.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {user ? (
                <Link
                  href={repos?.[0] ? `/repo/${repos[0].id}` : "/login"}
                  className="group relative rounded-2xl border border-white/10 bg-white px-5 py-3 text-sm font-medium text-black hover:bg-white/90"
                >
                  <span className="absolute inset-0 -z-10 rounded-2xl bg-blue-500/20 blur-xl opacity-50 transition-opacity duration-300 group-hover:opacity-80"></span>
                  Enter the Chamber
                </Link>
              ) : (
              <a
                href="#waitlist-email"
                className="group relative rounded-2xl border border-white/10 bg-white px-5 py-3 text-sm font-medium text-black hover:bg-white/90"
              >
                <span className="absolute inset-0 -z-10 rounded-2xl bg-blue-500/20 blur-xl opacity-50 transition-opacity duration-300 group-hover:opacity-80"></span>
                Request Early Access
              </a>
              )}

              <a
                href="#how-it-works"
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 hover:bg-white/10"
              >
                What Vestaryn Does
              </a>
            </div>

            <div className="mt-5 inline-flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
              <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-200/80">
                Chamber Stable
              </div>

              {user ? (
                <div className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-blue-200/80">
                  Access Granted
                </div>
              ) : (
                <div className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-blue-200/80">
                  Small-Batch Early Access
                </div>
              )}

              <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-200/80">
                Verification Active
              </div>
            </div>

            {user?.email ? (
              <div className="mt-4 text-xs font-mono text-white/30">
                Signed in as {user.email}
              </div>
            ) : (
              <div className="mt-4 max-w-2xl text-xs text-white/35">
                We’re onboarding a limited group of developers, learners, and
                small teams exploring controlled AI-assisted repository change.
              </div>
            )}
          </div>
        </section>

        {/* signed-in repos */}
        {user ? (
          <section className="mt-1 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
              <div className="text-xs uppercase tracking-[0.24em] text-white/40">
                Create
              </div>
              <div className="mt-2 text-lg font-medium text-white/88">
                New repo
              </div>

              <form action="/api/repos" method="post" className="mt-4 flex gap-2">
                <input
                  name="name"
                  placeholder="New repo name"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/85 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-blue-400/40"
                />
                <button className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/85 hover:bg-white/10">
                  Create
                </button>
              </form>

              <div className="mt-3 text-xs text-white/35">
                Keep names short. The chamber will reuse them everywhere.
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
              <div className="text-xs uppercase tracking-[0.24em] text-white/40">
                Recent
              </div>
              <div className="mt-2 text-lg font-medium text-white/88">
                Repos
              </div>

              <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {repos?.length ? (
                  repos.map((repo) => (
                    <Link
                      key={repo.id}
                      href={`/repo/${repo.id}`}
                      className="group flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white/85">
                          {repo.name || "Untitled"}
                        </div>
                        <div className="truncate font-mono text-[10px] text-white/30">
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
                    No repos yet. Create your first chamber.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {/* process strip */}
        <section
          id="how-it-works"
          className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8"
        >
          <div className="text-xs uppercase tracking-[0.24em] text-white/40">
            Execution Loop
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {["Ask", "Propose", "Verify", "Approve", "Apply"].map((step) => (
              <div
                key={step}
                className="relative rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm text-white/85 shadow-[inset_0_0_12px_rgba(59,130,246,0.08)] transition-all duration-300 hover:border-blue-400/20 hover:shadow-[inset_0_0_18px_rgba(59,130,246,0.18)] after:absolute after:left-3 after:right-3 after:top-0 after:h-px after:bg-blue-400/20 after:opacity-40"
              >
                {step}
              </div>
            ))}
          </div>

          <p className="mt-5 max-w-3xl text-sm leading-6 text-white/52">
            Vestaryn moves from intent to repository change without mutating
            code blindly. Changes are staged, reviewable, and verifiable before
            and after apply.
          </p>
        </section>

        {/* differentiators */}
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
            <div className="text-sm font-medium text-white/90">
              Conversational Reasoning
            </div>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Work with a chamber that understands repository context, intent,
              and implementation goals instead of generating isolated code.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
            <div className="text-sm font-medium text-white/90">
              Staged File Proposals
            </div>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Changes are proposed before they are applied, so repository
              mutation stays explicit, inspectable, and reversible.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
            <div className="text-sm font-medium text-white/90">
              Verification in the Loop
            </div>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Vestaryn integrates verification directly into the chamber so file
              state, failures, and progress remain visible.
            </p>
          </div>
        </section>

        {/* product / chamber section */}
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-white/40">
              Chamber Surface
            </div>

            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white/92">
              Built around repository state, not chat alone.
            </h2>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/55">
              The chamber combines reasoning, file proposals, verification, and
              repository visibility in one controlled environment. The goal is
              not just to generate code, but to move safely from user intent to
              verified repository change.
            </p>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
              <div className="grid grid-cols-3 gap-3 text-xs text-white/35">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  Chat
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  Vault
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  Editor
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/65">
                Intent → Proposal Set → Preverify → Approval → Apply → Verify
              </div>
            </div>
          </div>

          <div
            id="early-access"
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md"
          >
            <div className="text-xs uppercase tracking-[0.24em] text-white/40">
              Early Access
            </div>

            {user ? (
              <>
                <h3 className="mt-3 text-xl font-semibold text-white/92">
                  Access already granted
                </h3>

                <p className="mt-4 text-sm leading-6 text-white/55">
                  You already have access to the chamber. Continue into your
                  workspace and resume controlled repository work.
                </p>

                <div className="mt-6 flex flex-col gap-3">
                  <Link
                    href={repos?.[0] ? `/repo/${repos[0].id}` : "/login"}
                    className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-center text-sm font-medium text-black hover:bg-white/90"
                  >
                    Continue to the Chamber
                  </Link>

                  <div className="rounded-2xl border border-blue-400/20 bg-blue-400/10 px-4 py-3 text-sm text-blue-100/80">
                    Signed in users bypass the waitlist.
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="mt-3 text-xl font-semibold text-white/92">
                  Request early access to Vestaryn
                </h3>

                <p className="mt-4 text-sm leading-6 text-white/55">
                  Vestaryn is opening in small batches while the chamber is
                  being refined. Join the waitlist to get updates and early
                  access consideration.
                </p>

                {/* ✅ WAITLIST STATE FEEDBACK */}
{waitlistState === "success" && (
  <>
    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100/80">
      You’re on the list. We’ll open access in small batches.
    </div>

    <div className="mt-4 text-sm text-white/45">
      You’ll hear from us when the next access batch opens.
    </div>
  </>
)}

                {waitlistState === "invalid" && (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/80">
                    Please enter a valid email address.
                  </div>
                )}

                {waitlistState === "error" && (
                  <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100/80">
                    Something went wrong while joining the waitlist. Please try again.
                  </div>
                )}

                  {waitlistState !== "success" && (
                    <form
                      action="/api/waitlist"
                      method="post"
                      className="mt-6 flex flex-col gap-3"
                      >            
                  <input
                    id="waitlist-email"
                    type="email"
                    name="email"
                    required
                    placeholder="you@email.com"
                    className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/85 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-blue-400/40"
                  />

                  <input
                    type="text"
                    name="use_case"
                    placeholder="What are you building? (optional)"
                    className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/85 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-blue-400/40"
                  />

                  <input type="hidden" name="source" value="homepage" />

                  <button
                    type="submit"
                    className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-center text-sm font-medium text-black hover:bg-white/90"
                  >
                    Join the Waitlist
                  </button>
                </form>
              )}

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">
                  Small-batch onboarding. No broad public release yet.
                </div>

                <div className="mt-4 text-sm text-white/45">
                  Already invited?{" "}
                  <Link
                    href="/login"
                    className="text-white/75 underline underline-offset-4 hover:text-white"
                  >
                    Sign in
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>

        {/* footer note */}
        <div className="mt-10 pb-4 text-[11px] text-white/28">
          Vestaryn is in active development. Early access users should expect a
          controlled system with sharp edges.
        </div>
      </div>
    </div>
  );
}