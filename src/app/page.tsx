import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/auth/current-business";

// The public-facing marketing site is www.falahchat.com (a separate
// project) -- this app's own root is only ever reached by someone already
// signed in or mid-login, so it just routes to the right place rather than
// showing a static placeholder. Google's OAuth "Application home page" was
// switched to www.falahchat.com for this exact reason -- see CHANGELOG.
export default async function Home() {
  const context = await getCurrentBusinessContext();
  redirect(context ? "/dashboard" : "/login");
}
