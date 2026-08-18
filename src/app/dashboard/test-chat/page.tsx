import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { ChatWidget } from "./chat-widget";
import { PageHeader } from "../ui";

export default async function TestChatPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <PageHeader
        title="Test your assistant"
        description={`Chat with ${context.business.assistant_name || "your assistant"} the way a website visitor would. This uses the same chat engine a real visitor would, including your monthly message quota -- it isn't a separate sandbox.`}
      />
      <ChatWidget
        businessId={context.business.id}
        assistantName={context.business.assistant_name}
        assistantPhotoUrl={context.business.assistant_photo_url}
      />
    </div>
  );
}
