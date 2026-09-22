import { useT } from "@agent-native/core/client/i18n";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The idea the whole session is grilling, rendered to be read rather than
 * glanced at. It is deliberately not the page's heading — the shell header
 * already carries the session title, and two competing titles reads worse than
 * one long sentence.
 */
export function SessionIdea({ idea }: { idea: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // Only measurable while clamped: expanding removes the overflow that proves
  // the toggle is needed, so the answer is kept rather than recomputed.
  useLayoutEffect(() => {
    if (expanded) return;
    const element = ref.current;
    if (!element) return;

    function measure() {
      if (!element) return;
      setClipped(element.scrollHeight > element.clientHeight + 1);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, idea]);

  return (
    <div className="flex max-w-3xl flex-col items-start gap-0.5">
      <p
        ref={ref}
        data-testid="session-idea"
        className={cn(
          "text-[15px] leading-relaxed text-foreground/90",
          !expanded && "line-clamp-2",
        )}
      >
        {idea}
      </p>
      {clipped ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {t(expanded ? "workspace.ideaLess" : "workspace.ideaMore")}
        </Button>
      ) : null}
    </div>
  );
}
