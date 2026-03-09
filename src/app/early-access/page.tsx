export default function EarlyAccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white px-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Vestaryn is in invite-only early access
        </h1>

        <p className="mt-4 text-sm leading-6 text-white/70">
          This workspace is currently limited to approved early access users.
          Please sign in with an email address that has been approved.
        </p>

        <p className="mt-3 text-sm leading-6 text-white/50">
          If you believe you should have access, contact the person who invited you.
        </p>
      </div>
    </main>
  );
}