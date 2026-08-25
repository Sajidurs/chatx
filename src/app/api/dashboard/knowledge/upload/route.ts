import { randomUUID } from "crypto";
import { NextResponse, after } from "next/server";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";
import { processKnowledgeSource } from "@/lib/knowledge/process";
import type { KnowledgeSourceType } from "@/lib/knowledge/extract";

// Plain JSON-returning counterpart to the old uploadKnowledgeSource server
// action -- moved here so the dashboard can upload via XHR and show a real
// byte-progress bar, which a <form action={serverAction}> submission can't
// give the browser.
const TYPE_BY_EXTENSION: Record<string, KnowledgeSourceType> = {
  pdf: "pdf",
  docx: "doc",
  doc: "doc",
  txt: "text",
  md: "text",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

export async function POST(request: Request) {
  const context = await getCurrentBusinessContext();
  if (!context) return NextResponse.json({ error: "Please log in again." }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 15MB)." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPE_BY_EXTENSION[extension];
  if (!type) {
    return NextResponse.json({ error: "Unsupported file type. Upload a PDF, .docx, or .txt file." }, { status: 400 });
  }

  const admin = createAdminClient();
  const storagePath = `${context.business.id}/${randomUUID()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage.from("knowledge-sources").upload(storagePath, buffer, { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });

  const { data: source, error: insertError } = await admin
    .from("knowledge_sources")
    .insert({ business_id: context.business.id, type, file_url: storagePath, status: "processing" })
    .select("id")
    .single();
  if (insertError || !source) {
    await admin.storage.from("knowledge-sources").remove([storagePath]);
    return NextResponse.json({ error: "Could not save the upload. Please try again." }, { status: 500 });
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

  return NextResponse.json({ ok: true, sourceId: source.id });
}
