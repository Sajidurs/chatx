import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { CopySnippetButton } from "./copy-snippet-button";
import { PageHeader, Card } from "../ui";

export default async function EmbedPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const snippet = `<script src="${appUrl}/embed.js" data-business-id="${context.business.id}" async></script>`;

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <PageHeader
        title="Embed on your website"
        description="Paste this snippet just before the closing </body> tag of your website. It adds a floating chat bubble in the bottom-right corner -- it won't affect or conflict with anything else on your page."
      />

      <Card className="bg-gray-50">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-gray-700">{snippet}</pre>
      </Card>

      <CopySnippetButton snippet={snippet} />

      <p className="text-xs text-gray-500">
        The widget automatically uses your assistant&apos;s name, photo, and training -- the same one you can try on the{" "}
        <a href="/dashboard/test-chat" className="font-medium text-brand-700 hover:underline">
          Test chat
        </a>{" "}
        page.
      </p>
    </div>
  );
}
