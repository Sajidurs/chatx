"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { takeOverConversation, handBackToAI, sendBusinessReply, markConversationSeen } from "../actions";

type Message = { role: "visitor" | "assistant" | "business" | "system"; content: string; createdAt: string };

const BUBBLE_STYLES: Record<Message["role"], string> = {
  visitor: "ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gray-900 px-3.5 py-2.5 text-sm text-white",
  assistant: "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900",
  business: "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-brand-100 px-3.5 py-2.5 text-sm text-brand-900",
  system: "mx-auto max-w-[90%] rounded-md bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800",
};

export function ConversationPanel({
  sessionId,
  initialMessages,
  initialControlledBy,
}: {
  sessionId: string;
  initialMessages: Message[];
  initialControlledBy: "ai" | "human";
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [controlledBy, setControlledBy] = useState(initialControlledBy);
  const [reply, setReply] = useState("");
  const [isPending, startTransition] = useTransition();
  const lastMessageAtRef = useRef(initialMessages[initialMessages.length - 1]?.createdAt);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Marks this conversation caught-up as soon as it's actually opened in a
  // browser -- an effect, not something done during the page's server
  // render, since Next.js prefetching a link would otherwise mark a
  // conversation "seen" before anyone actually looked at it.
  useEffect(() => {
    markConversationSeen(sessionId);
  }, [sessionId]);

  // Poll for anything new (the visitor typing, or the AI replying if
  // control is still theirs) so this stays live without a manual refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}&after=${encodeURIComponent(lastMessageAtRef.current || "")}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!data?.messages?.length) {
        if (data?.controlledBy) setControlledBy(data.controlledBy);
        return;
      }
      // A reply this browser tab just sent is always already shown
      // optimistically -- see the matching note in the widget's own poll
      // effect for why re-adding it here would risk a visible duplicate.
      const newOnes = data.messages.filter((m: Message) => m.role !== "business");
      if (newOnes.length) setMessages((prev) => [...prev, ...newOnes]);
      lastMessageAtRef.current = data.messages[data.messages.length - 1].createdAt;
      setControlledBy(data.controlledBy);
    }, 4000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  return (
    <div className="flex flex-col gap-3">
      {/* Sticky so the take-over/hand-back control (and whose turn it is)
          stays visible while scrolling through a long conversation -- the
          dashboard's <main> is the actual scrolling container this sticks
          within. */}
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
        <p className="text-sm text-gray-600">
          {controlledBy === "human" ? (
            <>
              <span className="font-medium text-brand-700">You&apos;re handling this conversation.</span> The AI won&apos;t reply until you hand it back.
            </>
          ) : (
            "The AI is currently replying to this conversation."
          )}
        </p>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              if (controlledBy === "ai") {
                await takeOverConversation(sessionId);
                setControlledBy("human");
              } else {
                await handBackToAI(sessionId);
                setControlledBy("ai");
              }
            })
          }
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium ${
            controlledBy === "human" ? "border border-gray-200 hover:bg-gray-50" : "bg-brand-500 text-white hover:bg-brand-600"
          }`}
        >
          {controlledBy === "human" ? "Hand back to AI" : "Take over"}
        </button>
      </div>

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

      {controlledBy === "human" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = reply.trim();
            if (!text) return;
            // A plain onSubmit handler, not <form action={fn}> -- passing a
            // function to action defers the whole handler (including this
            // optimistic update) until React's form-action machinery
            // resolves it, which in practice meant the bubble didn't appear
            // until the server round-trip finished (~1.8s measured), not
            // instantly. A regular event handler commits this synchronously.
            setMessages((prev) => [...prev, { role: "business", content: text, createdAt: new Date().toISOString() }]);
            lastMessageAtRef.current = new Date().toISOString();
            setReply("");
            startTransition(() => sendBusinessReply(sessionId, text));
          }}
          className="flex gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"
        >
          <input
            name="message"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply as yourself..."
            className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <button type="submit" disabled={!reply.trim()} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
