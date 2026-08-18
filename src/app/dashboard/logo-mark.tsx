import fs from "fs";
import path from "path";
import Image from "next/image";
import { MessageCircle } from "lucide-react";

// Falls back to a plain icon square until the real logo file is dropped
// into public/ -- this component doesn't need touching once it is. Checks
// a couple of common filenames/extensions since the real logo arrived as
// "Logo.webp" (renamed to lowercase for Vercel's case-sensitive filesystem,
// but checking both here is a cheap safety net either way).
const CANDIDATES = ["logo.webp", "logo.png", "logo.svg"];
const FOUND_LOGO = CANDIDATES.find((name) => fs.existsSync(path.join(process.cwd(), "public", name)));

export function LogoMark() {
  if (FOUND_LOGO) {
    return (
      <div className="flex h-8 w-8 items-center justify-center">
        <Image src={`/${FOUND_LOGO}`} alt="Falah Chat" width={32} height={32} className="h-8 w-8 object-contain" />
      </div>
    );
  }

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
      <MessageCircle className="h-4 w-4" />
    </div>
  );
}
