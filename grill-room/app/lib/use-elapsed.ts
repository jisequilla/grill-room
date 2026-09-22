import { useEffect, useState } from "react";

/**
 * Elapsed time since `since` as `1:07`, ticking once a second. `null` reads as
 * `0:00` — the caller passes `null` for "not currently running" rather than
 * mounting and unmounting the hook.
 */
export function useElapsed(since: string | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  if (!since) return "0:00";
  const startedAt = new Date(since).getTime();
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
