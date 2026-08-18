import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { CopySnippetButton } from "./copy-snippet-button";

export default async function EmbedPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const snippet = `<script src="${appUrl}/embed.js" data-business-id="${context.business.id}" async></script>`;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Embed on your website</h1>
        <p className="text-sm text-gray-600">
          Paste this snippet just before the closing <code>&lt;/body&gt;</code> tag of your
          website. It adds a floating chat bubble in the bottom-right corner -- it won&apos;t
          affect or conflict with anything else on your page.
        </p>
      </div>

      <div className="rounded-lg border bg-gray-50 p-4">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-gray-800">{snippet}</pre>
      </div>

      <CopySnippetButton snippet={snippet} />

      <p className="text-xs text-gray-500">
        The widget automatically uses your assistant&apos;s name, photo, and training -- the
        same one you can try on the{" "}
        <a href="/dashboard/test-chat" className="underline">
          Test chat
        </a>{" "}
        page.
      </p>
    </div>
  );
}
