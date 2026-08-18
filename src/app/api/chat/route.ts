import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { respondToVisitorMessage } from "@/lib/chat/respond";

// Public endpoint -- website visitors chatting through the embed widget (or
// the dashboard's test-chat page) are anonymous, not Supabase-authenticated
// business users, so this can't be gated the way dashboard routes are.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.businessId !== "string" || typeof body.message !== "string") {
    return NextResponse.json({ error: "businessId and message are required." }, { status: 400 });
  }
  if (!body.message.trim()) {
    return NextResponse.json({ error: "message cannot be empty." }, { status: 400 });
  }

  const visitorId = typeof body.visitorId === "string" && body.visitorId ? body.visitorId : randomUUID();
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

  // Optional: the widget's intake form sends both together exactly once, to
  // start a conversation. Validated server-side too -- this is a public,
  // unauthenticated endpoint, so the client's own form validation isn't
  // something to rely on alone.
  let lead: { name: string; email: string } | undefined;
  if (typeof body.leadName === "string" && typeof body.leadEmail === "string") {
    const name = body.leadName.trim();
    const email = body.leadEmail.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid name and email are required." }, { status: 400 });
    }
    lead = { name, email };
  }

  try {
    const result = await respondToVisitorMessage({
      businessId: body.businessId,
      sessionId,
      visitorId,
      message: body.message,
      lead,
    });
    return NextResponse.json({ ...result, visitorId });
  } catch (err) {
    if (err instanceof Error && err.message === "Business not found") {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }
    console.error("Chat request failed", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
