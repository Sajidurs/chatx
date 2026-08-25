import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { respondToVisitorMessage } from "@/lib/chat/respond";

// Public endpoint -- website visitors chatting through the embed widget (or
// the dashboard's test-chat page) are anonymous, not Supabase-authenticated
// business users, so this can't be gated the way dashboard routes are.
// Only ever accepts an image URL pointing at our own upload bucket -- not an
// arbitrary URL an unauthenticated caller could point at any image on the
// internet, which would turn this public endpoint into a free image-analysis
// proxy billed to whichever business's plan the request names.
const CHAT_IMAGE_URL_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-images/`;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.businessId !== "string" || typeof body.message !== "string") {
    return NextResponse.json({ error: "businessId and message are required." }, { status: 400 });
  }

  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.startsWith(CHAT_IMAGE_URL_PREFIX) ? body.imageUrl : undefined;

  // A message needs either real text or an attached image -- not neither,
  // but an image with no caption (like sending a photo with nothing typed)
  // is a normal thing to send.
  if (!body.message.trim() && !imageUrl) {
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
      imageUrl,
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
