"use client";

import { useState, useRef, useEffect } from "react";

type Message = { role: "visitor" | "assistant" | "system"; content: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ChatWidget({ businessId }: { businessId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const visitorIdRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        await sleep(reply.delayMs);
        setMessages((prev) => [...prev, { role: "assistant", content: reply.content }]);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[500px] flex-col rounded-lg border">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "visitor"
                ? "ml-auto max-w-[80%] rounded-lg bg-black px-3 py-2 text-sm text-white"
                : m.role === "system"
                  ? "mx-auto max-w-[90%] rounded-md bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800"
                  : "mr-auto max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm"
            }
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
