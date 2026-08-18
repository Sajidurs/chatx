import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets, so the session cookie
     * stays fresh for every page/route handler without wasting work on
     * images, fonts, etc. Also excludes the public embed widget (/widget,
     * embed.js) -- it's an anonymous, cookie-free surface loaded on
     * third-party sites via iframe/script tag, potentially at high volume,
     * so it has no reason to pay for a Supabase session refresh.
     */
    "/((?!_next/static|_next/image|favicon.ico|embed\\.js|widget/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
