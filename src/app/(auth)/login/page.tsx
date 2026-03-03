"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");
  const [sending, setSending] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    setStatus("Sending magic link…");

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    // keep logs for now (dev)
    console.log("OTP result:", { data, error });

    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus("Sent. Check your inbox (and spam) for the magic link.");
    }

    setSending(false);
  }

async function signInWithProvider(provider: "google" | "github") {
  setStatus(`Opening ${provider}…`);

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${location.origin}/auth/callback`,
    },
  });

  if (error) setStatus(`Error: ${error.message}`);
}

  return (
    <div className="min-h-screen w-full bg-black">
      {/* background */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.18),transparent_55%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,0.10),transparent_55%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.06),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/70 to-black" />
      </div>

      <div className="relative mx-auto max-w-xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-white/90 tracking-tight">
          Vestaryn Login
        </h1>
        <div className="mt-1 text-sm text-white/50">
          Send a magic link to sign in.
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md shadow-[0_20px_40px_rgba(0,0,0,0.45)] p-6">
          <form onSubmit={signIn} className="space-y-3">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85 placeholder:text-white/35 outline-none focus:ring-1 focus:ring-blue-400/40"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              >
                Continue with Google
              </button>

              <button
                type="button"
                onClick={() => signInWithProvider("github")}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              >
                Continue with GitHub
              </button>
            </div>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <div className="text-[11px] text-white/35">or</div>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <button
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              type="submit"
              disabled={sending || !email.trim()}
            >
              {sending ? "Sending…" : "Send Magic Link"}
            </button>
          </form>

          {status ? (
            <div className="mt-4 text-sm text-white/65">{status}</div>
          ) : (
            <div className="mt-4 text-sm text-white/35">
              If you don’t see the email, check spam. Links can take a moment.
            </div>
          )}
        </div>

        <div className="mt-6 text-[11px] text-white/30">
          By continuing, you’ll create an account automatically if you don’t have
          one yet.
        </div>
      </div>
    </div>
  );
}