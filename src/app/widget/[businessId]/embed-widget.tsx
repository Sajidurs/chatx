"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Message = { role: "visitor" | "assistant" | "system"; content: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postSizeToParent(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  window.parent.postMessage(
    { source: "chatx-widget", type: "resize", width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
    "*"
  );
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

export function EmbedWidget({
  businessId,
  assistantName,
  assistantPhotoUrl,
}: {
  businessId: string;
  assistantName: string | null;
  assistantPhotoUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const visitorIdRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Same visitor + conversation persists across page reloads on the host
  // site, since this iframe is always loaded from our own origin no matter
  // which site embeds it -- localStorage here is scoped per business ID so
  // one visitor chatting with two different businesses never mixes identity.
  useEffect(() => {
    visitorIdRef.current = localStorage.getItem(`chatx_visitor_${businessId}`) || undefined;
    sessionIdRef.current = localStorage.getItem(`chatx_session_${businessId}`) || undefined;
  }, [businessId]);

  useEffect(() => {
    // See the same fix in the dashboard's test-chat widget: skip the
    // scrollIntoView call on the initial empty-message mount, since a
    // smooth-scroll animation racing the page's own layout as it settles
    // can land the surrounding page at the wrong final scroll position.
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, typing]);

  // The iframe itself is resized by the parent page's loader script to
  // exactly match this widget's real rendered size -- report it whenever the
  // bubble/panel toggles or content changes, rather than hardcoding two
  // fixed sizes that could drift out of sync with the actual layout.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    postSizeToParent(el);
    const observer = new ResizeObserver(() => postSizeToParent(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

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
      localStorage.setItem(`chatx_session_${businessId}`, data.sessionId);
      localStorage.setItem(`chatx_visitor_${businessId}`, data.visitorId);

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

  if (!open) {
    return (
      <div ref={rootRef} className="inline-block p-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-black shadow-lg transition-transform hover:scale-105"
        >
          {assistantPhotoUrl ? (
            <Image src={assistantPhotoUrl} alt={assistantName || "Chat"} width={64} height={64} className="h-full w-full object-cover" unoptimized />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-white">
              <path
                d="M4 4h16v12H7l-3 3V4z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="inline-block p-3">
      <div className="flex h-[600px] w-[370px] flex-col overflow-hidden rounded-xl border bg-white text-gray-900 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="mr-auto max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900">
              Hi! How can I help you today?
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "visitor"
                  ? "ml-auto max-w-[80%] rounded-lg bg-black px-3 py-2 text-sm text-white"
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
          className="flex gap-2 border-t p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-md border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
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
    </div>
  );
}
