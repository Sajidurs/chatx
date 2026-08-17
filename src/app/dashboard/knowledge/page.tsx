import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { uploadKnowledgeSource, deleteKnowledgeSource } from "./actions";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
      <h1 className="text-xl font-semibold">Training documents</h1>
      <p className="text-sm text-gray-600">
        Upload PDFs, Word documents (.docx), or plain text files. Your assistant learns from
        these to answer visitor questions.
      </p>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form action={uploadKnowledgeSource} className="flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".pdf,.doc,.docx,.txt,.md"
          required
          className="flex-1 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Upload
        </button>
      </form>

      <ul className="flex flex-col gap-2 text-sm">
        {sources?.map((source) => (
          <li key={source.id} className="flex items-center justify-between border-b py-2">
            <span>
              {source.file_url.split("/").slice(1).join("/")}{" "}
              <span className="text-gray-500">({source.type})</span>
            </span>
            <span className="flex items-center gap-3">
              <span
                className={
                  source.status === "ready"
                    ? "text-green-700"
                    : source.status === "failed"
                      ? "text-red-700"
                      : "text-yellow-700"
                }
              >
                {source.status}
              </span>
              <form action={deleteKnowledgeSource}>
                <input type="hidden" name="sourceId" value={source.id} />
                <button type="submit" className="text-gray-500 underline">
                  Delete
                </button>
              </form>
            </span>
          </li>
        ))}
        {sources?.length === 0 && <li className="text-gray-500">No documents uploaded yet.</li>}
      </ul>
    </div>
  );
}
