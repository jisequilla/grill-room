import { useT } from "@agent-native/core/client/i18n";

import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEPTH_HELP_KEY,
  DEPTH_LABEL_KEY,
  TECHNICAL_LEVEL_HELP_KEY,
  TECHNICAL_LEVEL_LABEL_KEY,
} from "@/lib/session-labels";

import {
  DEPTHS,
  TECHNICAL_LEVELS,
  type Depth,
  type TechnicalLevel,
} from "@shared/session-constants";

const OPTION_CLASS =
  "h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left";

/**
 * The new-session dialog's second screen: how deep to grill the idea and how
 * technical the owner is. It only renders the picks; the dialog owns them,
 * the profile query and what is sent.
 */
export function SessionSetupStep({
  depth,
  level,
  onDepthChange,
  onLevelChange,
}: {
  depth: Depth;
  level: TechnicalLevel | null;
  onDepthChange: (depth: Depth) => void;
  onLevelChange: (level: TechnicalLevel) => void;
}) {
  const t = useT();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("sessions.setupDescription")}
      </p>
      <div className="space-y-2">
        <Label id="setup-depth-label">{t("sessions.depthLabel")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={depth}
          onValueChange={(value) => {
            if (value) onDepthChange(value as Depth);
          }}
          aria-labelledby="setup-depth-label"
          className="flex w-full flex-col gap-1.5"
        >
          {DEPTHS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              data-testid={`setup-depth-${value}`}
              className={OPTION_CLASS}
            >
              <span className="text-sm font-medium">
                {t(DEPTH_LABEL_KEY[value])}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {t(DEPTH_HELP_KEY[value])}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-2">
        <Label id="setup-level-label">{t("sessions.levelLabel")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={level ?? ""}
          onValueChange={(value) => {
            if (value) onLevelChange(value as TechnicalLevel);
          }}
          aria-labelledby="setup-level-label"
          className="flex w-full flex-col gap-1.5"
        >
          {TECHNICAL_LEVELS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              data-testid={`setup-level-${value}`}
              className={OPTION_CLASS}
            >
              <span className="text-sm font-medium">
                {t(TECHNICAL_LEVEL_LABEL_KEY[value])}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {t(TECHNICAL_LEVEL_HELP_KEY[value])}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
