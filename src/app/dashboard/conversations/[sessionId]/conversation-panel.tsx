"use client";

import { useEffect, useRef, useState } from "react";
import { markConversationSeen } from "../actions";

type Message = { role: "visitor" | "assistant" | "business" | "system"; content: string; createdAt: string };

// "business" role is kept here (not removed along with the take-over UI)
// since older conversations may already have human-authored replies stored
// from before that feature was hidden -- this still needs to render them.
const BUBBLE_STYLES: Record<Message["role"], string> = {
  visitor: "ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gray-900 px-3.5 py-2.5 text-sm text-white",
  assistant: "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900",
  business: "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-brand-100 px-3.5 py-2.5 text-sm text-brand-900",
  system: "mx-auto max-w-[90%] rounded-md bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800",
};

export function ConversationPanel({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const lastMessageAtRef = useRef(initialMessages[initialMessages.length - 1]?.createdAt);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Marks this conversation caught-up as soon as it's actually opened in a
  // browser -- an effect, not something done during the page's server
  // render, since Next.js prefetching a link would otherwise mark a
  // conversation "seen" before anyone actually looked at it.
  useEffect(() => {
    markConversationSeen(sessionId);
  }, [sessionId]);

  // Poll so a conversation the visitor is actively having shows the AI's
  // new replies here without a manual refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}&after=${encodeURIComponent(lastMessageAtRef.current || "")}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!data?.messages?.length) return;
      setMessages((prev) => [...prev, ...data.messages]);
      lastMessageAtRef.current = data.messages[data.messages.length - 1].createdAt;
    }, 4000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2.5">
        {messages.map((m, i) => (
          <div key={i} className={BUBBLE_STYLES[m.role] || BUBBLE_STYLES.assistant}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
