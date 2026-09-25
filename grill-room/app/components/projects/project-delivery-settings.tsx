import { useT } from "@agent-native/core/client/i18n";

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

import { DELIVERY_RECIPES, type DeliveryRecipe } from "@shared/session-constants";

interface ProjectDeliverySettingsProps {
  deliveryRecipe: DeliveryRecipe;
  onDeliveryRecipeChange: (value: DeliveryRecipe) => void;
  adversarialReview: boolean;
  onAdversarialReviewChange: (value: boolean) => void;
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
        <p id="project-delivery-recipe-hint" className="text-xs text-muted-foreground">
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
    </>
  );
}
