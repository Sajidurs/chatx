import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { ConversationPanel } from "./conversation-panel";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id, visitor_id, started_at, needs_handoff, handoff_reason, controlled_by")
    .eq("id", sessionId)
    .eq("business_id", context.business.id)
    .single();

  if (!session) notFound();

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/dashboard/conversations" className="flex w-fit items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" />
        Back to conversations
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visitor {session.visitor_id.slice(0, 8)}</h1>
        <p className="text-sm text-gray-500">Started {new Date(session.started_at).toLocaleString()}</p>
      </div>

      {session.needs_handoff && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <p className="font-medium">This conversation was flagged for your attention.</p>
          <p>{session.handoff_reason}</p>
        </div>
      )}

      <ConversationPanel
        sessionId={sessionId}
        initialControlledBy={session.controlled_by}
        initialMessages={(messages ?? []).map((m) => ({
          role: m.role as "visitor" | "assistant" | "business",
          content: m.content,
          createdAt: m.created_at,
        }))}
      />
    </div>
  );
}
