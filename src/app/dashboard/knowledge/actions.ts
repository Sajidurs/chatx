"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";
import { processKnowledgeSource } from "@/lib/knowledge/process";
import type { KnowledgeSourceType } from "@/lib/knowledge/extract";

const TYPE_BY_EXTENSION: Record<string, KnowledgeSourceType> = {
  pdf: "pdf",
  docx: "doc",
  doc: "doc",
  txt: "text",
  md: "text",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

function fail(message: string): never {
  redirect(`/dashboard/knowledge?error=${encodeURIComponent(message)}`);
}

export async function uploadKnowledgeSource(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Please choose a file to upload.");
  if (file.size > MAX_FILE_BYTES) fail("File is too large (max 15MB).");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPE_BY_EXTENSION[extension];
  if (!type) fail("Unsupported file type. Upload a PDF, .docx, or .txt file.");

  const admin = createAdminClient();
  const storagePath = `${context.business.id}/${randomUUID()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("knowledge-sources")
    .upload(storagePath, buffer, { contentType: file.type || undefined });
  if (uploadError) fail("Upload failed. Please try again.");

  const { data: source, error: insertError } = await admin
    .from("knowledge_sources")
    .insert({ business_id: context.business.id, type, file_url: storagePath, status: "processing" })
    .select("id")
    .single();
  if (insertError) {
    await admin.storage.from("knowledge-sources").remove([storagePath]);
    fail("Could not save the upload. Please try again.");
  }

  // Runs after this response is sent -- the founder sees "processing"
  // immediately rather than waiting on extraction/chunking/embedding.
  after(() =>
    processKnowledgeSource({
      sourceId: source.id,
      businessId: context.business.id,
      storagePath,
      type,
    })
  );

  redirect("/dashboard/knowledge");
}

export async function deleteKnowledgeSource(formData: FormData) {
  const context = await getCurrentBusinessContext();
  if (!context) redirect("/login");

  const sourceId = String(formData.get("sourceId") || "");
  const admin = createAdminClient();

  const { data: source } = await admin
    .from("knowledge_sources")
    .select("file_url")
    .eq("id", sourceId)
    .eq("business_id", context.business.id)
    .single();
  if (!source) fail("Document not found.");

  await admin.storage.from("knowledge-sources").remove([source.file_url]);
  await admin.from("knowledge_sources").delete().eq("id", sourceId).eq("business_id", context.business.id);

  redirect("/dashboard/knowledge");
}
