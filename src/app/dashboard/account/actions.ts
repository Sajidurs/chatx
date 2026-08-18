"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function fail(message: string): never {
  redirect(`/dashboard/account?error=${encodeURIComponent(message)}`);
}

function saved(what: "profile" | "photo" | "password"): never {
  redirect(`/dashboard/account?saved=${what}`);
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const displayName = field(formData, "displayName");
  if (!displayName) fail("Please enter a name.");

  const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
  if (error) fail("Could not save your name. Please try again.");
  saved("profile");
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB, matches the assistant photo limit
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAvatarPhoto(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) fail("Please choose an image to upload.");
  if (file.size > MAX_PHOTO_BYTES) {
    fail(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 8MB).`);
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    fail(`Unsupported image type (${file.type || "unknown"}). Please upload a PNG, JPEG, or WebP image.`);
  }

  const admin = createAdminClient();
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const storagePath = `${user.id}/${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage.from("user-avatars").upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) fail("Upload failed. Please try again.");

  const { data: publicUrl } = admin.storage.from("user-avatars").getPublicUrl(storagePath);

  const { error } = await supabase.auth.updateUser({ data: { avatar_url: publicUrl.publicUrl } });
  if (error) fail("Could not save the photo. Please try again.");

  saved("photo");
}

export async function changePassword(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const newPassword = field(formData, "newPassword");
  const confirmPassword = field(formData, "confirmPassword");

  if (newPassword.length < 8) fail("New password must be at least 8 characters.");
  if (newPassword !== confirmPassword) fail("New password and confirmation don't match.");

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) fail(error.message || "Could not update your password. Please try again.");

  saved("password");
}
