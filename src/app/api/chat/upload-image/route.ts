import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public endpoint -- same trust model as /api/chat itself: an anonymous
// website visitor, identified only by the businessId they're chatting with,
// not a Supabase-authenticated user.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // matches the assistant-photo upload limit elsewhere
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const businessId = formData?.get("businessId");
  const file = formData?.get("image");

  if (typeof businessId !== "string" || !businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose an image to upload." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: `Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 8MB).` }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type (${file.type || "unknown"}).` }, { status: 400 });
  }

  const admin = createAdminClient();
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const storagePath = `${businessId}/${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage.from("chat-images").upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) {
    console.error("Chat image upload failed", uploadError);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: publicUrl } = admin.storage.from("chat-images").getPublicUrl(storagePath);
  return NextResponse.json({ url: publicUrl.publicUrl });
}
