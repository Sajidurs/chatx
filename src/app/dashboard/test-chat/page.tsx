import { getCurrentBusinessContext } from "@/lib/auth/current-business";
import { ChatWidget } from "./chat-widget";

export default async function TestChatPage() {
  const context = await getCurrentBusinessContext();
  if (!context) return null;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Test your assistant</h1>
        <p className="text-sm text-gray-600">
          Chat with {context.business.assistant_name || "your assistant"} the way a website
          visitor would. This uses the same chat engine a real visitor would, including your
          monthly message quota -- it isn&apos;t a separate sandbox.
        </p>
      </div>
      <ChatWidget
        businessId={context.business.id}
        assistantName={context.business.assistant_name}
        assistantPhotoUrl={context.business.assistant_photo_url}
      />
    </div>
  );
}
