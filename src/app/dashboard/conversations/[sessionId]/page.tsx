import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, visitor_id, started_at, needs_handoff, handoff_reason")
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
      <Link href="/dashboard/conversations" className="text-sm text-gray-500 hover:underline">
        &larr; Back to conversations
      </Link>

      <div>
        <h1 className="text-xl font-semibold">Visitor {session.visitor_id.slice(0, 8)}</h1>
        <p className="text-sm text-gray-600">Started {new Date(session.started_at).toLocaleString()}</p>
      </div>

      {session.needs_handoff && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <p className="font-medium">This conversation was flagged for your attention.</p>
          <p>{session.handoff_reason}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border p-4">
        {messages?.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "visitor"
                ? "ml-auto max-w-[80%] rounded-lg bg-black px-3 py-2 text-sm text-white"
                : "mr-auto max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900"
            }
          >
            {m.content}
          </div>
        ))}
      </div>
    </div>
  );
}
