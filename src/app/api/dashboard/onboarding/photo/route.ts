import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { createAdminClient } from "@/lib/supabase/admin";

// Plain JSON-returning counterpart to the old uploadAssistantPhoto server
// action -- moved here so the dashboard can upload via XHR and show a real
// byte-progress bar, which a <form action={serverAction}> submission can't
// give the browser.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB -- matches the old server action's limit
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const context = await getCurrentBusinessContext();
  if (!context) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  if (context.role !== "owner") {
    return NextResponse.json({ error: "Only the business owner can edit assistant setup." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose an image to upload." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: `Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 8MB).` }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type (${file.type || "unknown"}). Please upload a PNG, JPEG, or WebP image.` }, { status: 400 });
  }

  const admin = createAdminClient();
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const storagePath = `${context.business.id}/${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage.from("assistant-photos").upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });

  const { data: publicUrl } = admin.storage.from("assistant-photos").getPublicUrl(storagePath);

  const { error } = await admin.from("businesses").update({ assistant_photo_url: publicUrl.publicUrl }).eq("id", context.business.id);
  if (error) return NextResponse.json({ error: "Could not save the photo. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true, url: publicUrl.publicUrl });
}
