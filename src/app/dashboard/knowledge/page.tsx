import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { uploadKnowledgeSource, deleteKnowledgeSource } from "./actions";
import { PageHeader, Card } from "../ui";
import { ErrorBanner } from "../confirm-banners";

const STATUS_STYLES: Record<string, string> = {
  ready: "text-brand-700",
  failed: "text-red-600",
  processing: "text-yellow-700",
};

export default async function KnowledgePage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const supabase = await createClient();
  const { data: sources } = await supabase
    .from("knowledge_sources")
    .select("id, type, file_url, status, created_at")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Training documents"
        description="Upload PDFs, Word documents (.docx), or plain text files. Your assistant learns from these to answer visitor questions."
      />

      <ErrorBanner />

      <Card>
        <form action={uploadKnowledgeSource} className="flex items-center gap-3">
          <input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md" required className="flex-1 text-sm text-gray-600" />
          <button type="submit" className="shrink-0 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
            Upload
          </button>
        </form>
      </Card>

      <Card className="!p-2">
        {sources?.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">No documents uploaded yet.</p>}
        <ul className="flex flex-col divide-y divide-gray-50 text-sm">
          {sources?.map((source) => (
            <li key={source.id} className="flex items-center justify-between px-4 py-3">
              <span>
                {source.file_url.split("/").slice(1).join("/")} <span className="text-gray-400">({source.type})</span>
              </span>
              <span className="flex items-center gap-4">
                <span className={`font-medium ${STATUS_STYLES[source.status] || "text-gray-500"}`}>{source.status}</span>
                <form action={deleteKnowledgeSource}>
                  <input type="hidden" name="sourceId" value={source.id} />
                  <button type="submit" className="text-gray-400 hover:text-red-600 hover:underline">
                    Delete
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
