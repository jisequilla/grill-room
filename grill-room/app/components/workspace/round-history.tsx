import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import { VerdictTag } from "@/components/workspace/review-digest";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ANSWER_KIND_LABEL_KEY, type TreeDecision } from "@/lib/decisions";
import { mostRecentReAskBefore } from "@/lib/review-digest";

type RoundsResult = AgentNativeActionRegistry["list-rounds"]["result"];
type Round = RoundsResult["rounds"][number];

function RoundSection({
  round,
  number,
  decisionsById,
}: {
  round: Round;
  number: number;
  decisionsById: ReadonlyMap<string, TreeDecision>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <IconChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90"
          data-open={open}
        />
        <span className="text-sm font-medium">
          {t("workspace.roundLabel", { number })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("workspace.roundCardCount", { count: round.decisions.length })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-2 py-2 pr-2 pl-8">
          {round.decisions.map((decision) => {
            // A question that resurfaces here because the interviewer
            // re-asked it (rather than being asked for the first time) shows
            // why, off the same classification the detail sheet and the
            // digest use — so the three places never disagree about which
            // rows are review verdicts.
            const full = decisionsById.get(decision.id);
            const reAsk = full
              ? mostRecentReAskBefore(full, round.createdAt)
              : null;

            return (
              <li key={decision.id} className="border-l-2 border-muted pl-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm leading-snug">{decision.questionTitle}</p>
                  {reAsk ? <VerdictTag verdict="re-ask" /> : null}
                </div>
                {reAsk ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{reAsk.reason}</p>
                ) : null}
                {decision.answeredInRound ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium">
                      {t(
                        ANSWER_KIND_LABEL_KEY[
                          decision.answeredInRound.answerKind
                        ],
                      )}
                    </span>
                    {decision.answeredInRound.answer
                      ? ` — ${decision.answeredInRound.answer}`
                      : ""}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground italic">
                    {t("workspace.noAnswerRecorded")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Previous rounds, collapsed, so the interview can be read back. The round
 * still open is the one on screen above, so it is not repeated here — but it
 * keeps its number, so what is listed matches what was asked.
 */
export function RoundHistory({
  rounds,
  decisions,
}: {
  rounds: readonly Round[];
  /** The whole tree, history included — where a "re-asked" label comes from. */
  decisions: readonly TreeDecision[];
}) {
  const t = useT();
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));
  const submitted = rounds
    .map((round, index) => ({ round, number: index + 1 }))
    .filter((entry) => entry.round.submissionState === "submitted");

  if (submitted.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        {t("workspace.historyEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-px">
      {submitted.map((entry) => (
        <RoundSection
          key={entry.round.id}
          round={entry.round}
          number={entry.number}
          decisionsById={decisionsById}
        />
      ))}
    </div>
  );
}
