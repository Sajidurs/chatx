import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "../ui";

export default async function LeadsPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, message, session_id, created_at")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Everyone who gave their name and email before chatting -- reach out directly, even if the conversation didn't finish."
      />

      {(!leads || leads.length === 0) && (
        <Card>
          <p className="text-sm text-gray-500">No leads yet -- they'll show up here as soon as a visitor starts a chat.</p>
        </Card>
      )}

      {leads && leads.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Email</th>
                <th className="pb-3 font-medium">Message</th>
                <th className="pb-3 font-medium">Received</th>
                <th className="pb-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="py-3 pr-4 font-medium">{lead.name}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    <a href={`mailto:${lead.email}`} className="text-brand-700 hover:underline">
                      {lead.email}
                    </a>
                  </td>
                  <td className="max-w-xs truncate py-3 pr-4 text-gray-500" title={lead.message ?? ""}>
                    {lead.message || "--"}
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{new Date(lead.created_at).toLocaleString()}</td>
                  <td className="py-3">
                    {lead.session_id && (
                      <Link href={`/dashboard/conversations/${lead.session_id}`} className="text-xs font-medium text-brand-700 hover:underline">
                        View conversation &rarr;
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
