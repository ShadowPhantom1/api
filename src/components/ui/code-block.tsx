"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function CodeBlock({
  code,
  language,
  className,
  maxHeight = "24rem",
}: {
  code: string;
  language?: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div className={cn("relative rounded-md border border-border bg-black/40", className)}>
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {language ?? "shell"}
        </span>
        <CopyButton value={code} />
      </div>
      <pre
        className="scrollbar-thin overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-200"
        style={{ maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
