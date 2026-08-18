import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated -- same trust model as /api/chat: a session ID is
// an unguessable UUID, not proof of identity beyond "the same browser that
// started this conversation." Polled by the widget while a human has taken
// a conversation over, so the visitor sees the reply without needing to
// send another message themselves first.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const after = searchParams.get("after");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: session } = await admin.from("chat_sessions").select("id, controlled_by").eq("id", sessionId).maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let query = admin
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (after) query = query.gt("created_at", after);

  const { data: messages } = await query;

  return NextResponse.json({
    controlledBy: session.controlled_by,
    messages: (messages ?? []).map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at })),
  });
}
