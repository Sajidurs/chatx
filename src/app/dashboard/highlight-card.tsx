import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

const TONE_STYLES = {
  warning: { bg: "bg-orange-100", fg: "text-orange-600", Icon: AlertTriangle },
  good: { bg: "bg-brand-100", fg: "text-brand-700", Icon: CheckCircle2 },
  info: { bg: "bg-blue-100", fg: "text-blue-600", Icon: Info },
} as const;

export function HighlightCard({
  tone,
  title,
  description,
  href,
}: {
  tone: keyof typeof TONE_STYLES;
  title: string;
  description: string;
  href: string;
}) {
  const { bg, fg, Icon } = TONE_STYLES[tone];

  return (
    <div className="flex gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg} ${fg}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
        <Link href={href} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
          View details
        </Link>
      </div>
    </div>
  );
}
