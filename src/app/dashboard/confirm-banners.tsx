"use client";

import { useSearchParams } from "next/navigation";

// Client-side, not read from the page's own `searchParams` prop -- a real
// bug was found while building the account page: a page whose Server
// Component reads `searchParams` and also contains an <input type="file">
// form causes that form's submission to silently fail client-side (no
// request ever fires) once the URL already carries a query string from an
// earlier action's redirect. Decoupling these banners into their own client
// component (reading the URL via this hook instead) keeps the page itself
// free of a `searchParams` prop, which avoids the bug entirely.
export function SavedBanner({ value, children }: { value: string; children: React.ReactNode }) {
  const params = useSearchParams();
  if (params.get("saved") !== value) return null;
  return <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">{children}</p>;
}

export function ErrorBanner() {
  const params = useSearchParams();
  const error = params.get("error");
  if (!error) return null;
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
}
