"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Message = { id?: string; role: "visitor" | "assistant" | "business" | "system"; content: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A short two-tone chime synthesized with the Web Audio API rather than a
// hosted audio file -- one less asset to embed/host, and it works the same
// wherever this widget is embedded. Lazily creates one AudioContext and
// reuses it; browsers block audio until a real user gesture has happened on
// the page, which is already guaranteed here (opening the chat is a click).
let audioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  } catch {
    // Autoplay/audio policy quirks shouldn't ever break the chat itself.
  }
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // sessionIdRef flips from undefined to a real ID asynchronously (either
  // after the history fetch below, or after a brand-new visitor's first
  // message resolves in sendMessage) -- a plain ref mutation alone doesn't
  // trigger a re-render, so the polling effect further down needs this
  // state twin to actually notice and start once a session exists. Without
  // it, a first-time visitor's polling never started at all (see the note
  // by the poll effect for the exact bug this was).
  const [sessionKnown, setSessionKnown] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const visitorIdRef = useRef<string | undefined>(undefined);
  const lastMessageAtRef = useRef<string | undefined>(undefined);
  // A real customer hit this: an assistant reply could appear TWICE -- once
  // from this turn's own direct response, and again moments later when a
  // background poll tick landed before `lastMessageAtRef` had been advanced
  // past it (a genuine race on a slow multi-chunk reply, not a fluke --
  // confirmed only one row existed in the database, so the duplicate was
  // purely a client-side render, not a double-send). Tracking every
  // message's real id here, and never rendering the same id twice, removes
  // the race entirely instead of trying to time the cursor update just
  // right.
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A returning visitor (existing session already in localStorage) skips
  // straight to the chat panel -- the intake form is only for starting a
  // brand new conversation. Starts false and flips true in the effect below
  // once localStorage has actually been checked (client-only).
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadMessage, setLeadMessage] = useState("");

  // Same visitor + conversation persists across page reloads on the host
  // site, since this iframe is always loaded from our own origin no matter
  // which site embeds it -- localStorage here is scoped per business ID so
  // one visitor chatting with two different businesses never mixes identity.
  // The session ID surviving a refresh was already true before this, but the
  // visible message list was not -- `messages` always started empty, so a
  // refreshed visitor saw a blank panel even though the AI still remembered
  // everything. Reload the real history here so what's on screen matches
  // what's actually stored, refresh or not.
  useEffect(() => {
    visitorIdRef.current = localStorage.getItem(`chatx_visitor_${businessId}`) || undefined;
    sessionIdRef.current = localStorage.getItem(`chatx_session_${businessId}`) || undefined;
    setLeadCaptured(!!sessionIdRef.current);
    setSessionKnown(!!sessionIdRef.current);

    if (!sessionIdRef.current) {
      setHistoryLoaded(true);
      return;
    }
    fetch(`/api/chat/messages?sessionId=${sessionIdRef.current}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.messages?.length) {
          setMessages(
            data.messages.map((m: { id: string; role: string; content: string }) => ({ id: m.id, role: m.role, content: m.content }))
          );
          for (const m of data.messages) if (m.id) seenMessageIdsRef.current.add(m.id);
          lastMessageAtRef.current = data.messages[data.messages.length - 1].createdAt;
        }
      })
      .finally(() => setHistoryLoaded(true));
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
  }, [open, leadCaptured]);

  // Poll for new messages as soon as a session exists, minimized or open --
  // not gated on `open` (a ref flipping sessionIdRef.current doesn't
  // re-render, so this effect keys off the `sessionKnown` state twin
  // instead; see its declaration above for why that's necessary) or on
  // already knowing a human has taken over -- that state itself can only
  // change while the visitor is just sitting there (an owner taking over
  // mid-conversation), so there's no "your own message's response told you"
  // moment to hang the decision to start polling on. Also what makes the
  // notification sound work while minimized: with no polling while closed,
  // there would be nothing to notice a new message with.
  useEffect(() => {
    if (!sessionKnown || !sessionIdRef.current) return;

    async function poll() {
      const res = await fetch(
        `/api/chat/messages?sessionId=${sessionIdRef.current}&after=${encodeURIComponent(lastMessageAtRef.current || "")}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => null);
      if (!data) return;
      if (data.messages?.length) {
        // A visitor's own message is always already shown the instant they
        // send it (optimistic update in sendMessage), and never carries an
        // id polling would recognize anyway, so it's excluded by role.
        // Everything else is deduped by real id -- see seenMessageIdsRef's
        // declaration for the duplicate-message bug this fixes.
        const newOnes = data.messages.filter(
          (m: { id: string; role: string }) => m.role !== "visitor" && !seenMessageIdsRef.current.has(m.id)
        );
        if (newOnes.length) {
          for (const m of newOnes) seenMessageIdsRef.current.add(m.id);
          setMessages((prev) => [
            ...prev,
            ...newOnes.map((m: { id: string; role: string; content: string }) => ({ id: m.id, role: m.role, content: m.content })),
          ]);
          playNotificationSound();
        }
        lastMessageAtRef.current = data.messages[data.messages.length - 1].createdAt;
      }
    }

    const interval = setInterval(poll, 4000);
    // Browsers throttle setInterval heavily (sometimes to once a minute or
    // less) in a background/inactive tab -- exactly what happens when a
    // visitor leaves the widget's tab open and switches away, which is the
    // normal way someone would be testing a human handoff from a separate
    // dashboard tab. Without this, a reply sent while backgrounded could sit
    // unseen for a long time, only appearing once something (like a manual
    // refresh) forced a fresh fetch. Re-polling immediately the moment the
    // tab becomes visible/focused again closes that gap.
    function onVisibilityOrFocus() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [sessionKnown]);

  // A visitor typing (and even sending) a follow-up while the AI is still
  // replying to the previous message shouldn't be blocked -- but the backend
  // processes one message per request against shared conversation state, so
  // a second /api/chat call firing while the first is still in flight would
  // race on that state. Queueing client-side gets the best of both: nothing
  // blocks typing or hitting send, requests still go out one at a time.
  const pendingQueueRef = useRef<string[]>([]);

  async function sendMessage(text: string, lead?: { name: string; email: string }) {
    if (!text) return;

    setMessages((prev) => [...prev, { role: "visitor", content: text }]);
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
          ...(lead ? { leadName: lead.name, leadEmail: lead.email } : {}),
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
      lastMessageAtRef.current = new Date().toISOString();
      setSessionKnown(true);

      if (data.blocked) {
        setMessages((prev) => [...prev, { role: "system", content: data.blockedReason }]);
        return;
      }

      // Registered up front, before the typing-delay display loop below
      // even starts -- these replies already exist in the database right
      // now, so a poll tick landing anywhere during the next several
      // seconds of simulated typing needs to already know to skip them.
      for (const reply of data.replies as { id: string; content: string; delayMs: number }[]) {
        if (reply.id) seenMessageIdsRef.current.add(reply.id);
      }

      for (const reply of data.replies as { id: string; content: string; delayMs: number }[]) {
        setTyping(true);
        await sleep(reply.delayMs);
        setTyping(false);
        setMessages((prev) => [...prev, { id: reply.id, role: "assistant", content: reply.content }]);
      }
    } finally {
      setTyping(false);
      setSending(false);
      const next = pendingQueueRef.current.shift();
      if (next) sendMessage(next);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (sending) {
      pendingQueueRef.current.push(text);
      return;
    }
    await sendMessage(text);
  }

  async function submitLead() {
    const name = leadName.trim();
    const email = leadEmail.trim();
    const message = leadMessage.trim();
    if (!name || !email || !message || sending) return;
    setLeadCaptured(true);
    setLeadMessage("");
    await sendMessage(message, { name, email });
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
            <div className="flex flex-col">
              <span className="text-sm font-medium">{assistantName || "Assistant"}</span>
            </div>
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

        {!historyLoaded ? null : !leadCaptured ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitLead();
            }}
            className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
          >
            <p className="text-sm text-gray-600">
              Hi! Tell us a little about yourself and we&apos;ll get started -- {assistantName || "our assistant"} will pick up right where you
              leave off below.
            </p>
            <input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Your name"
              required
              disabled={sending}
              className="rounded-md border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
            />
            <input
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
              type="email"
              placeholder="Your email"
              required
              disabled={sending}
              className="rounded-md border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
            />
            <textarea
              value={leadMessage}
              onChange={(e) => setLeadMessage(e.target.value)}
              placeholder="How can we help?"
              required
              rows={3}
              disabled={sending}
              className="flex-1 resize-none rounded-md border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
            />
            <button
              type="submit"
              disabled={sending || !leadName.trim() || !leadEmail.trim() || !leadMessage.trim()}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Start chat
            </button>
          </form>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
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
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
