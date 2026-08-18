"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";

type Message = { role: "visitor" | "assistant" | "system"; content: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function TypingDots() {
  return (
    <div className="mr-auto flex w-fit items-center gap-1 rounded-lg bg-gray-100 px-3 py-2.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" />
    </div>
  );
}

export function ChatWidget({
  businessId,
  assistantName,
  assistantPhotoUrl,
}: {
  businessId: string;
  assistantName?: string | null;
  assistantPhotoUrl?: string | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const visitorIdRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Nothing to scroll to yet on first mount (empty message list) -- calling
    // scrollIntoView then let a smooth-scroll animation race the page's own
    // layout as it settles, landing the whole dashboard shell at the wrong
    // final scroll position (a real bug, not just an empty-state no-op).
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, typing]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: "visitor", content: text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          message: text,
          sessionId: sessionIdRef.current,
          visitorId: visitorIdRef.current,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "system", content: data.error || "Something went wrong." }]);
        return;
      }

      sessionIdRef.current = data.sessionId;
      visitorIdRef.current = data.visitorId;

      if (data.blocked) {
        setMessages((prev) => [...prev, { role: "system", content: data.blockedReason }]);
        return;
      }

      for (const reply of data.replies as { content: string; delayMs: number }[]) {
        setTyping(true);
        await sleep(reply.delayMs);
        setTyping(false);
        setMessages((prev) => [...prev, { role: "assistant", content: reply.content }]);
      }
    } finally {
      setTyping(false);
      setSending(false);
    }
  }

  return (
    <div className="flex h-[500px] flex-col rounded-2xl border border-gray-100 bg-white text-gray-900 shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        {assistantPhotoUrl ? (
          <Image
            src={assistantPhotoUrl}
            alt={assistantName || "Assistant"}
            width={28}
            height={28}
            className="rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-500">
            {(assistantName || "A")[0].toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium">{assistantName || "Assistant"}</span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "visitor"
                ? "ml-auto max-w-[80%] rounded-lg bg-brand-500 px-3 py-2 text-sm text-white"
                : m.role === "system"
                  ? "mx-auto max-w-[90%] rounded-md bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800"
                  : "mr-auto max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900"
            }
          >
            {m.content}
          </div>
        ))}
        {typing && <TypingDots />}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t border-gray-100 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
