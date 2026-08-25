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
    <div className="mr-auto flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-3">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
    </div>
  );
}

// A small green presence dot anchored to the bottom-right of an avatar --
// always "online" since the assistant is available around the clock, no
// real away/offline state exists in the system to reflect instead.
function OnlineDot({ size = "h-3 w-3" }: { size?: string }) {
  return <span className={`absolute -right-0.5 -bottom-0.5 ${size} rounded-full border-2 border-white bg-brand-500`} />;
}

const STARTER_PROMPTS = ["👋 Just saying hi", "I have a question", "I'd like to book an appointment"];

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
  const [showGreeting, setShowGreeting] = useState(false);
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

  // A proactive "we're online" bubble, like a real receptionist waving --
  // only for a brand-new visitor (an existing session means they've already
  // met the widget before) and only once they've been on the page a moment,
  // not the instant it loads. Auto-dismisses on its own after a while rather
  // than sitting there forever if it's ignored.
  useEffect(() => {
    if (sessionIdRef.current) return;
    const showTimer = setTimeout(() => setShowGreeting(true), 2500);
    return () => clearTimeout(showTimer);
  }, [businessId]);

  useEffect(() => {
    if (!showGreeting) return;
    const hideTimer = setTimeout(() => setShowGreeting(false), 10000);
    return () => clearTimeout(hideTimer);
  }, [showGreeting]);

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
      // flex-col + normal document flow (not absolute positioning) for the
      // greeting bubble is deliberate -- this whole tree is loaded inside an
      // iframe that the host page resizes to exactly match its measured
      // content box (see postSizeToParent below and embed.js). An
      // absolutely-positioned child doesn't contribute to its parent's
      // getBoundingClientRect(), so the iframe would never actually grow to
      // show it -- an iframe hard-clips to its own box regardless of any
      // CSS overflow inside it. Confirmed directly against the real embed.js
      // mechanism, not just the standalone /widget preview page (which has
      // no iframe to clip against and so hid this bug).
      <div ref={rootRef} className="inline-flex flex-col items-end gap-2 p-3">
        {showGreeting && (
          <div className="animate-bubble-pop-in relative flex w-64 items-start gap-2 rounded-2xl rounded-br-md bg-white p-3.5 pr-8 text-left shadow-2xl">
            <span className="relative mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand-500" />
            </span>
            <p className="text-sm text-gray-700">
              <span className="font-semibold text-gray-900">We&apos;re online!</span> Chat with {assistantName || "us"} now.
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowGreeting(false);
              }}
              aria-label="Dismiss"
              className="absolute right-2 top-2 cursor-pointer rounded-full p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setShowGreeting(false);
            }}
            aria-label="Open chat"
            className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-brand-500 shadow-lg shadow-brand-500/30 transition-transform hover:scale-105"
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
          <span className="absolute bottom-3.5 right-3.5 h-4 w-4 rounded-full border-[3px] border-white bg-brand-400" />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="inline-block p-3">
      <div className="flex h-[600px] w-[370px] flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white text-gray-900 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              {assistantPhotoUrl ? (
                <Image
                  src={assistantPhotoUrl}
                  alt={assistantName || "Assistant"}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">
                  {(assistantName || "A")[0].toUpperCase()}
                </div>
              )}
              <OnlineDot />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{assistantName || "Assistant"}</span>
              <span className="text-xs text-gray-400">Online</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize chat"
              className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {!historyLoaded ? null : !leadCaptured ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitLead();
            }}
            className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4"
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
              className="rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            />
            <input
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
              type="email"
              placeholder="Your email"
              required
              disabled={sending}
              className="rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            />
            <textarea
              value={leadMessage}
              onChange={(e) => setLeadMessage(e.target.value)}
              placeholder="How can we help?"
              required
              rows={3}
              disabled={sending}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            />
            {/* Predefined starter prompts -- one tap fills the message field
                above so a visitor doesn't have to think of what to type;
                still goes through the same name/email/message submission. */}
            <div className="flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setLeadMessage(prompt)}
                  className="cursor-pointer rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={sending || !leadName.trim() || !leadEmail.trim() || !leadMessage.trim()}
              className="cursor-pointer rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start chat
            </button>
          </form>
        ) : (
          <>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`animate-message-in ${
                    m.role === "visitor"
                      ? "ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2.5 text-sm text-white"
                      : m.role === "system"
                        ? "mx-auto max-w-[90%] rounded-xl bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800"
                        : "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900"
                  }`}
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
              className="flex items-center gap-2 border-t border-gray-100 p-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] translate-x-[1px]">
                  <path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor" />
                </svg>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
