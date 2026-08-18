"use client";

import { useState } from "react";

export function CopySnippetButton({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="w-fit rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
    >
      {copied ? "Copied!" : "Copy snippet"}
    </button>
  );
}
