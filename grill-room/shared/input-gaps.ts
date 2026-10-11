/** Where a consumed item comes from: a ticket number, `"repo"`, or no known source. */
export type ConsumeSource = number | "repo" | null;

export type GapReason =
  | "no-source"
  | "not-produced"
  | "unknown-ticket"
  | "not-upstream"
  | "not-tracked";

/** A consumed item nothing resolves, as the server reports it. */
export interface InputGapLike {
  ticket: number;
  item: string;
  from: ConsumeSource;
  reason: GapReason;
}

const NO_SOURCE_PHRASE = "no ticket or repository file provides it.";

/**
 * The sentence that says why a consumed item is unresolved. The reason alone
 * decides it, except `unknown-ticket` naming the ticket itself. A numbered
 * reason paired with a non-number `from` (a hand-written row) reads as
 * `no-source`.
 */
export function inputGapPhrase(
  gap: Pick<InputGapLike, "ticket" | "from" | "reason">,
  label: (n: number) => string,
): string {
  const { from, reason } = gap;
  switch (reason) {
    case "not-tracked":
      return "the repository tracks no file at that path.";
    case "not-produced":
      return typeof from === "number"
        ? `ticket ${label(from)} does not list it in what it produces.`
        : NO_SOURCE_PHRASE;
    case "unknown-ticket":
      if (typeof from !== "number") return NO_SOURCE_PHRASE;
      return from === gap.ticket
        ? "it names itself as its source."
        : `it names ticket ${label(from)}, which does not exist.`;
    case "not-upstream":
      return typeof from === "number"
        ? `ticket ${label(from)} produces it but is not upstream through Blocked by.`
        : NO_SOURCE_PHRASE;
    case "no-source":
      return NO_SOURCE_PHRASE;
  }
}

/** One ticket's gaps in the order given, each as the quoted item, a dash and its phrase. */
export function ticketGapLines(
  gaps: readonly InputGapLike[],
  ticket: number,
  label: (n: number) => string,
): string[] {
  return gaps
    .filter((gap) => gap.ticket === ticket)
    .map((gap) => `${JSON.stringify(gap.item)} — ${inputGapPhrase(gap, label)}`);
}
