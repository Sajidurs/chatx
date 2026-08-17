import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractText, type KnowledgeSourceType } from "@/lib/knowledge/extract";
import { chunkText } from "@/lib/knowledge/chunk";
import { embedDocuments } from "@/lib/ai/voyage";

/**
 * Extracts, chunks, and embeds an uploaded knowledge source, storing the
 * results in knowledge_chunks and marking the source ready/failed. Runs
 * after the upload response has already been sent (see the upload route's
 * use of `after()`), so failures here can't be surfaced to that request --
 * they're recorded on the source row's status instead, which the dashboard
 * polls/displays.
 */
export async function processKnowledgeSource(params: {
  sourceId: string;
  businessId: string;
  storagePath: string;
  type: KnowledgeSourceType;
}) {
  const admin = createAdminClient();

  try {
    const { data: file, error: downloadError } = await admin.storage
      .from("knowledge-sources")
      .download(params.storagePath);
    if (downloadError || !file) throw downloadError ?? new Error("Download returned no file");

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buffer, params.type);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await admin.from("knowledge_sources").update({ status: "failed" }).eq("id", params.sourceId);
      return;
    }

    const embeddings = await embedDocuments(chunks);

    const rows = chunks.map((content, i) => ({
      business_id: params.businessId,
      source_id: params.sourceId,
      content,
      embedding: embeddings[i],
    }));

    const { error: insertError } = await admin.from("knowledge_chunks").insert(rows);
    if (insertError) throw insertError;

    await admin.from("knowledge_sources").update({ status: "ready" }).eq("id", params.sourceId);
  } catch (err) {
    console.error(`Failed to process knowledge source ${params.sourceId}`, err);
    await admin.from("knowledge_sources").update({ status: "failed" }).eq("id", params.sourceId);
  }
}
