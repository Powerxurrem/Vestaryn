"use client";

import { useState } from "react";

/**
 * @file ChatInput.tsx
 * @purpose Input control for ChatFrame (single-message submit).
 * @exports ChatInput
 *
 * @sections
 * - Props
 * - Local state
 * - Action: submit
 * - Render: input + send button
 *
 * @invariants
 * - Trims whitespace before sending.
 * - Clears local state before awaiting onSend (optimistic UI).
 * - Enter (without Shift) submits; Shift+Enter reserved for future multiline support.
 *
 * @touchpoints
 * - onSend(text) provided by ChatFrame
 *
 * @notes
 * - If streaming latency increases, consider disabling button while awaiting.
 * - Currently single-line input; can evolve to textarea without changing contract.
 */

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
type Props = {
  onSend: (text: string) => void | Promise<void>;
};

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ChatInput({ onSend }: Props) {
  // Local state
  const [value, setValue] = useState("");

  // ─────────────────────────────────────────────────────────────
  // Action: submit message
  // ─────────────────────────────────────────────────────────────
  const submit = async () => {
    const text = value.trim();
    if (!text) return;

    // Optimistic clear
    setValue("");

    await onSend(text);
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-blue-500/30">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Type here..."
        className="flex-1 bg-transparent text-blue-200/100 placeholder:text-blue-200/100 outline-none"
      />

      <button
        onClick={submit}
        className="shrink-0 rounded-lg px-4 py-2 text-sm text-blue-200 border border-blue-500/40 bg-white/[0.04] hover:bg-white/[0.06] active:bg-white/[0.08] transition"
      >
        Send
      </button>
    </div>
  );
}