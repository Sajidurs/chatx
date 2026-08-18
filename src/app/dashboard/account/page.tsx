import { redirect } from "next/navigation";
import { getCurrentUserProfile, initialsFor } from "@/lib/auth/current-user-profile";
import { updateProfile, uploadAvatarPhoto, changePassword } from "./actions";
import { PageHeader, Card } from "../ui";
import { SavedBanner, ErrorBanner } from "../confirm-banners";

const inputClass =
  "rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

export default async function AccountPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/login");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Account" description="Your own profile, photo, and password -- separate from your business's assistant settings." />

      <ErrorBanner />

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Photo</h2>
        <SavedBanner value="photo">Photo saved.</SavedBanner>
        <div className="flex items-center gap-4">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- small fixed-size avatar preview
            <img src={profile.avatarUrl} alt="Your photo" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-400">
              {initialsFor(profile.displayName || profile.email)}
            </div>
          )}
          <form action={uploadAvatarPhoto} className="flex items-center gap-2">
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
            <button type="submit" className="rounded-xl border border-gray-200 px-3.5 py-2 text-sm hover:bg-gray-50">
              Upload photo
            </button>
          </form>
        </div>
        <p className="text-xs text-gray-500">PNG, JPEG, or WebP, up to 8MB.</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Profile</h2>
        <SavedBanner value="profile">Name saved.</SavedBanner>
        <form action={updateProfile} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Your name
            <input name="displayName" defaultValue={profile.displayName ?? ""} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Email
            <input value={profile.email} disabled className={`${inputClass} bg-gray-50 text-gray-400`} />
          </label>
          <button type="submit" className="w-fit rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
            Save name
          </button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Password</h2>
        <SavedBanner value="password">Password updated.</SavedBanner>
        <form action={changePassword} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            New password
            <input name="newPassword" type="password" required minLength={8} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Confirm new password
            <input name="confirmPassword" type="password" required minLength={8} className={inputClass} />
          </label>
          <button type="submit" className="w-fit rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
            Update password
          </button>
        </form>
      </Card>
    </div>
  );
}
