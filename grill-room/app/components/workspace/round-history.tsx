import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ANSWER_KIND_LABEL_KEY } from "@/lib/decisions";

type RoundsResult = AgentNativeActionRegistry["list-rounds"]["result"];
type Round = RoundsResult["rounds"][number];

function RoundSection({ round, number }: { round: Round; number: number }) {
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
        {round.submissionState === "open" ? (
          <span className="ml-auto rounded-full border border-sky-600/30 bg-sky-600/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-sky-700 uppercase dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300">
            {t("workspace.roundOpen")}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-2 py-2 pr-2 pl-8">
          {round.decisions.map((decision) => (
            <li key={decision.id} className="border-l-2 border-muted pl-3">
              <p className="text-sm leading-snug">{decision.questionTitle}</p>
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
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Previous rounds, collapsed, so the interview can be read back. */
export function RoundHistory({ rounds }: { rounds: readonly Round[] }) {
  const t = useT();

  if (rounds.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        {t("workspace.historyEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-px">
      {rounds.map((round, index) => (
        <RoundSection key={round.id} round={round} number={index + 1} />
      ))}
    </div>
  );
}
