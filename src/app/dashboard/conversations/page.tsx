import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "../ui";

export default async function ConversationsPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id, visitor_id, started_at, last_message_at, last_visitor_message_at, last_seen_by_business_at, chat_messages(count)")
    .eq("business_id", context.business.id)
    .order("last_message_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Conversations" description="Every conversation your assistant has had with a website visitor." />

      {(!sessions || sessions.length === 0) && (
        <Card>
          <p className="text-sm text-gray-500">No conversations yet.</p>
        </Card>
      )}

      {sessions && sessions.length > 0 && (
        <Card className="!p-2">
          <div className="flex flex-col divide-y divide-gray-50">
            {sessions.map((s) => {
              const messageCount = (s.chat_messages as unknown as { count: number }[])?.[0]?.count ?? 0;
              // Unread means a visitor message arrived after this business
              // last actually opened the conversation -- the business's own
              // replies never count here, so answering someone doesn't make
              // their own conversation look unread to them again.
              const isUnread =
                !!s.last_visitor_message_at &&
                (!s.last_seen_by_business_at || new Date(s.last_visitor_message_at) > new Date(s.last_seen_by_business_at));
              return (
                <Link
                  key={s.id}
                  href={`/dashboard/conversations/${s.id}`}
                  className="flex items-center justify-between rounded-xl px-4 py-3.5 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2.5">
                    {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                    <div className="flex flex-col">
                      <span className={`text-sm ${isUnread ? "font-semibold text-gray-900" : "font-medium"}`}>
                        Visitor {s.visitor_id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {messageCount} message{messageCount === 1 ? "" : "s"} &middot; last active{" "}
                        {new Date(s.last_message_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
