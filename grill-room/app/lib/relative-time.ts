import type { useFormatters } from "@agent-native/core/client/i18n";

type Formatters = ReturnType<typeof useFormatters>;

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/** Formats an ISO timestamp as a locale-aware relative time, e.g. "3 hours ago". */
export function formatRelativeTimestamp(
  formatters: Formatters,
  isoTimestamp: string,
): string {
  const diffMs = new Date(isoTimestamp).getTime() - Date.now();

  for (const { unit, ms } of UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return formatters.formatRelativeTime(Math.round(diffMs / ms), unit);
    }
  }

  return formatters.formatRelativeTime(Math.round(diffMs / 1000), "second");
}
