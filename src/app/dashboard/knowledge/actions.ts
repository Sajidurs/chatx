"use server";

import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";

function fail(message: string): never {
  redirect(`/dashboard/knowledge?error=${encodeURIComponent(message)}`);
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
