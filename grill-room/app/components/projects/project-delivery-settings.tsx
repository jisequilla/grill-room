import { useT } from "@agent-native/core/client/i18n";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DELIVERY_RECIPE_HINT_KEY, DELIVERY_RECIPE_LABEL_KEY } from "@/lib/projects";

import {
  DEFAULT_MAX_TICKETS_IN_FLIGHT,
  DELIVERY_RECIPES,
  MAX_TICKETS_IN_FLIGHT,
  MIN_TICKETS_IN_FLIGHT,
  type DeliveryRecipe,
} from "@shared/session-constants";

interface ProjectDeliverySettingsProps {
  deliveryRecipe: DeliveryRecipe;
  onDeliveryRecipeChange: (value: DeliveryRecipe) => void;
  adversarialReview: boolean;
  onAdversarialReviewChange: (value: boolean) => void;
  preflightStep: boolean;
  onPreflightStepChange: (value: boolean) => void;
  /** The raw input text, so an empty or partial entry can be typed. */
  maxTicketsInFlight: string;
  onMaxTicketsInFlightChange: (value: string) => void;
  /** The registry's refusal of the field, shown in place of its hint. */
  maxTicketsInFlightError?: string;
}

export interface DeliverySettings {
  deliveryRecipe: DeliveryRecipe;
  adversarialReview: boolean;
  preflightStep: boolean;
  maxTicketsInFlight?: number;
}

/** The subset of a project's fields these settings are seeded from. */
interface DeliverySettingsSource {
  deliveryRecipe?: string | null;
  adversarialReview?: boolean | null;
  preflightStep?: boolean | null;
  maxTicketsInFlight?: number | null;
}

/**
 * What the dialog seeds these two fields to when it opens: `project`'s own
 * values, or the registration defaults (`pull-request`, review on) for a
 * fresh project, or when `project` is null (registration renders no
 * delivery settings, but a caller opening the dialog for "Add project"
 * still resets this pair of fields through the same path).
 */
export function seedDeliverySettings(project: DeliverySettingsSource | null): DeliverySettings {
  return {
    deliveryRecipe: (project?.deliveryRecipe as DeliveryRecipe | undefined) ?? "pull-request",
    adversarialReview: project?.adversarialReview ?? true,
    preflightStep: project?.preflightStep ?? true,
    maxTicketsInFlight: project?.maxTicketsInFlight ?? DEFAULT_MAX_TICKETS_IN_FLIGHT,
  };
}

/**
 * Folds the delivery settings into the rest of an edit's fields, for
 * `update-project`'s payload. Tickets in flight is left out when undefined,
 * so a blank field keeps the stored value.
 */
export function withDeliverySettings<T extends object>(
  fields: T,
  settings: DeliverySettings,
): T & DeliverySettings {
  return {
    ...fields,
    deliveryRecipe: settings.deliveryRecipe,
    adversarialReview: settings.adversarialReview,
    preflightStep: settings.preflightStep,
    ...(settings.maxTicketsInFlight === undefined
      ? {}
      : { maxTicketsInFlight: settings.maxTicketsInFlight }),
  };
}

/**
 * How a ticket built for this project reaches main, and whether a second
 * agent reviews it first. Shown only once a project is registered: the
 * recipe is guessed from the repository's remotes at registration, and
 * `update-project` is the only action that can change either setting.
 */
export function ProjectDeliverySettings({
  deliveryRecipe,
  onDeliveryRecipeChange,
  adversarialReview,
  onAdversarialReviewChange,
  preflightStep,
  onPreflightStepChange,
  maxTicketsInFlight,
  onMaxTicketsInFlightChange,
  maxTicketsInFlightError,
}: ProjectDeliverySettingsProps) {
  const t = useT();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="project-delivery-recipe">{t("projects.deliveryRecipeLabel")}</Label>
        <Select
          value={deliveryRecipe}
          onValueChange={(value) => onDeliveryRecipeChange(value as DeliveryRecipe)}
        >
          <SelectTrigger
            id="project-delivery-recipe"
            data-testid="project-delivery-recipe"
            aria-describedby="project-delivery-recipe-hint"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELIVERY_RECIPES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(DELIVERY_RECIPE_LABEL_KEY[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          id="project-delivery-recipe-hint"
          data-hint-key={DELIVERY_RECIPE_HINT_KEY[deliveryRecipe]}
          className="text-xs text-muted-foreground"
        >
          {t(DELIVERY_RECIPE_HINT_KEY[deliveryRecipe])}
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="project-adversarial-review">{t("projects.adversarialReviewLabel")}</Label>
          <p className="text-xs text-muted-foreground">{t("projects.adversarialReviewHint")}</p>
        </div>
        <Switch
          id="project-adversarial-review"
          data-testid="project-adversarial-review"
          checked={adversarialReview}
          onCheckedChange={onAdversarialReviewChange}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="project-preflight-step">{t("projects.preflightStepLabel")}</Label>
          <p className="text-xs text-muted-foreground">{t("projects.preflightStepHint")}</p>
        </div>
        <Switch
          id="project-preflight-step"
          data-testid="project-preflight-step"
          checked={preflightStep}
          onCheckedChange={onPreflightStepChange}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-max-tickets-in-flight">{t("projects.maxTicketsInFlightLabel")}</Label>
        <Input
          id="project-max-tickets-in-flight"
          data-testid="project-max-tickets-in-flight"
          type="number"
          min={MIN_TICKETS_IN_FLIGHT}
          max={MAX_TICKETS_IN_FLIGHT}
          step={1}
          className="w-24"
          value={maxTicketsInFlight}
          onChange={(event) => onMaxTicketsInFlightChange(event.target.value)}
          aria-invalid={maxTicketsInFlightError !== undefined}
          aria-describedby="project-max-tickets-in-flight-hint"
        />
        <p
          id="project-max-tickets-in-flight-hint"
          className={
            maxTicketsInFlightError ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {maxTicketsInFlightError ?? t("projects.maxTicketsInFlightHint")}
        </p>
      </div>
    </>
  );
}
