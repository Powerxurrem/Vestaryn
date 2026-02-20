"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Sending magic link...");

    console.log("Sending magic link to:", email);

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    console.log("OTP result:", { data, error });

    if (error) {
      setStatus(`Error: ${error.message}`);
      alert(`Supabase error: ${error.message}`);
    } else {
      setStatus("Sent. Check your inbox (and spam) for the magic link.");
      alert("Sent. Check your inbox (and spam) for the magic link.");
    }
  }

  return (
    <div className="p-8 max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Vestaryn Login</h1>

      <form onSubmit={signIn} className="space-y-3">
        <input
          className="border px-3 py-2 rounded w-full"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button className="border px-3 py-2 rounded w-full" type="submit">
          Send Magic Link
        </button>
      </form>

      {status ? <div className="text-sm opacity-80">{status}</div> : null}
    </div>
  );
}
