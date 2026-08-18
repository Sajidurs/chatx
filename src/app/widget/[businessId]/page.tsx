import { getPublicBusinessProfile } from "@/lib/business/public-profile";
import { EmbedWidget } from "./embed-widget";

export default async function WidgetPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const profile = await getPublicBusinessProfile(businessId);

  return (
    <>
      {/* This page is always loaded inside a cross-origin iframe on a
          third-party site -- the visible widget must float directly on the
          host page with no white box around it, so the document background
          is transparent from first paint (no client-side flash). */}
      <style>{`html, body { background: transparent !important; }`}</style>
      {profile && <EmbedWidget businessId={profile.id} assistantName={profile.assistantName} assistantPhotoUrl={profile.assistantPhotoUrl} />}
    </>
  );
}
