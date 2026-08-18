import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";

export default async function ConversationsPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id, visitor_id, started_at, last_message_at, needs_handoff, handoff_reason, chat_messages(count)")
    .eq("business_id", context.business.id)
    .order("last_message_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Conversations</h1>
        <p className="text-sm text-gray-600">Every conversation your assistant has had with a website visitor.</p>
      </div>

      {(!sessions || sessions.length === 0) && <p className="text-sm text-gray-500">No conversations yet.</p>}

      <div className="flex flex-col divide-y rounded-lg border">
        {sessions?.map((s) => {
          const messageCount = (s.chat_messages as unknown as { count: number }[])?.[0]?.count ?? 0;
          return (
            <Link
              key={s.id}
              href={`/dashboard/conversations/${s.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">Visitor {s.visitor_id.slice(0, 8)}</span>
                <span className="text-xs text-gray-500">
                  {messageCount} message{messageCount === 1 ? "" : "s"} -- last active{" "}
                  {new Date(s.last_message_at).toLocaleString()}
                </span>
              </div>
              {s.needs_handoff && (
                <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800">
                  Needs your help
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
