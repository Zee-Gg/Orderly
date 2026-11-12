"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copy / Share buttons for the customer menu page link. */
export function MenuLinkActions({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        icon={copied ? <Check /> : <Copy />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt("Copy this link", url);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button
        variant="secondary"
        icon={<Share2 />}
        onClick={() => {
          const nav: Navigator = navigator;
          if (typeof nav.share === "function") void nav.share({ title: name, text: `${name} — menu`, url }).catch(() => {});
          else void nav.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        Share
      </Button>
    </div>
  );
}
