"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onSend: (text: string) => void | Promise<void>;
};

export default function ChatInput({ onSend }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = async () => {
    const text = value.trim();
    if (!text) return;

    setValue("");
    await onSend(text);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <div className="flex items-end gap-3 px-4 py-3 border border-blue-500/30">
      <div className="min-w-0 flex-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Type here..."
          className="w-full min-w-0 max-h-[220px] resize-none overflow-x-hidden overflow-y-auto rounded-md bg-transparent text-blue-200/100 placeholder:text-blue-200/100 outline-none whitespace-pre-wrap break-words"
          style={{ overflowWrap: "anywhere" }}
        />
      </div>

      <button
        onClick={submit}
        className="shrink-0 rounded-lg px-4 py-2 text-sm text-blue-200 border border-blue-500/40 bg-white/[0.04] hover:bg-white/[0.06] active:bg-white/[0.08] transition"
      >
        Send
      </button>
    </div>
  );
}