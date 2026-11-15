import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SessionState } from "@/lib/decisions";
import { changedValue, depthControlState } from "@/lib/depth-level";
import {
  DEPTH_LABEL_KEY,
  TECHNICAL_LEVEL_LABEL_KEY,
} from "@/lib/session-labels";

import {
  DEPTHS,
  TECHNICAL_LEVELS,
  type Depth,
  type TechnicalLevel,
} from "@shared/session-constants";

const TRIGGER_CLASS =
  "h-7 w-auto gap-1 border-none bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:bg-accent focus:ring-1 focus:ring-ring focus:ring-offset-0";

/**
 * The session header's depth and technical-level selects. Which depth shows,
 * whether it can change and what a change does come from `depthControlState`;
 * the level belongs to the owner and is never locked. Renders nothing until
 * the rounds and the spec have loaded, so no note or warning is guessed.
 */
export function SessionDepthLevelControl({
  sessionId,
  depth,
  pendingDepth,
  state,
  turnStatus,
  technicalLevel,
  hasRound,
  specCurrent,
  onChanged,
}: {
  sessionId: string;
  depth: Depth;
  pendingDepth: Depth | null;
  state: SessionState;
  turnStatus: string;
  technicalLevel: TechnicalLevel | null;
  hasRound: boolean | undefined;
  specCurrent: boolean | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const [depthError, setDepthError] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

  const setDepth = useActionMutation("set-session-depth", {
    onSuccess: () => {
      setDepthError(null);
      onChanged();
    },
    onError: (error: unknown) => {
      setDepthError(
        actionErrorMessage(error) ?? t("workspace.depthChangeFailed"),
      );
      onChanged();
    },
  });

  const setLevel = useActionMutation("set-owner-technical-level", {
    onSuccess: () => {
      setLevelError(null);
      onChanged();
    },
    onError: (error: unknown) => {
      setLevelError(
        actionErrorMessage(error) ?? t("workspace.levelChangeFailed"),
      );
    },
  });

  if (hasRound === undefined || specCurrent === undefined) return null;

  const control = depthControlState({
    hasRound,
    state,
    turnStatus,
    depth,
    pendingDepth,
    specCurrent,
  });

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={control.shownDepth}
          disabled={control.disabled || setDepth.isPending}
          onValueChange={(value) => {
            const picked = changedValue(control.shownDepth, value as Depth);
            if (picked === null || setDepth.isPending) return;
            setDepthError(null);
            setDepth.mutate({ sessionId, depth: picked });
          }}
        >
          <SelectTrigger
            className={TRIGGER_CLASS}
            aria-label={t("workspace.depthSelectLabel")}
            data-testid="depth-control"
          >
            <SelectValue>{t(DEPTH_LABEL_KEY[control.shownDepth])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DEPTHS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(DEPTH_LABEL_KEY[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={technicalLevel ?? ""}
          disabled={setLevel.isPending}
          onValueChange={(value) => {
            const picked = changedValue(
              technicalLevel,
              value as TechnicalLevel,
            );
            if (picked === null || setLevel.isPending) return;
            setLevelError(null);
            setLevel.mutate({ technicalLevel: picked });
          }}
        >
          <SelectTrigger
            className={TRIGGER_CLASS}
            aria-label={t("workspace.levelSelectLabel")}
            data-testid="level-control"
          >
            <SelectValue placeholder={t("workspace.levelNotSet")}>
              {technicalLevel
                ? t(TECHNICAL_LEVEL_LABEL_KEY[technicalLevel])
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TECHNICAL_LEVELS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(TECHNICAL_LEVEL_LABEL_KEY[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="px-2 text-xs text-muted-foreground">
        <span data-testid="depth-control-note">{t(control.noteKey)}</span>{" "}
        <span data-testid="level-control-note">
          {t("workspace.levelAppliesNextRound")}
        </span>
      </p>
      {control.warningKeys.map((key) => (
        <p
          key={key}
          className="px-2 text-xs text-owed"
          data-testid={
            key === "workspace.depthReopensWarning"
              ? "depth-warning-reopens"
              : "depth-warning-stale"
          }
        >
          {t(key)}
        </p>
      ))}
      {depthError ? (
        <span
          className="px-2 text-xs text-destructive"
          data-testid="depth-control-error"
        >
          {depthError}
        </span>
      ) : null}
      {levelError ? (
        <span
          className="px-2 text-xs text-destructive"
          data-testid="level-control-error"
        >
          {levelError}
        </span>
      ) : null}
    </div>
  );
}
