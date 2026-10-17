"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function JsonViewer({
  value,
  maxHeight = "24rem",
  collapsedLines = 40,
}: {
  value: unknown;
  maxHeight?: string;
  collapsedLines?: number;
}) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }, [value]);
  const lines = text.split("\n").length;
  const [expanded, setExpanded] = useState(lines <= collapsedLines);
  const [wrap, setWrap] = useState(false);
  const shown = expanded ? text : text.split("\n").slice(0, collapsedLines).join("\n");

  return (
    <div className="rounded-md border border-border bg-black/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          JSON · {lines} lines
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setWrap((current) => !current)}>
            {wrap ? "No wrap" : "Wrap"}
          </Button>
          <CopyButton value={text} />
        </div>
      </div>
      <pre
        className={cn(
          "scrollbar-thin overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-200",
          wrap ? "whitespace-pre-wrap break-words" : "",
        )}
        style={{ maxHeight }}
      >
        {shown}
      </pre>
      {lines > collapsedLines ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-center justify-center gap-1 border-t border-border/70 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {expanded ? "Collapse" : `Show all ${lines} lines`}
        </button>
      ) : null}
    </div>
  );
}
