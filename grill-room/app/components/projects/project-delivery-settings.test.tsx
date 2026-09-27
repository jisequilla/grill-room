import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProjectDeliverySettings,
  seedDeliverySettings,
  withDeliverySettings,
} from "@/components/projects/project-delivery-settings";
import { DELIVERY_RECIPE_HINT_KEY } from "@/lib/projects";

/*
 * These render with no i18n catalog wired up (the same bare
 * `renderToStaticMarkup` pattern `readiness-panel.test.tsx` uses), so `useT()`
 * falls back to a humanized version of the key rather than this app's actual
 * `en-US.ts` copy. Assertions therefore read structure, test ids, and the
 * component's own data attributes, never the rendered label text.
 */

function render({
  deliveryRecipe = "pull-request" as const,
  adversarialReview = true,
  maxTicketsInFlight = "3",
  maxTicketsInFlightError,
}: {
  deliveryRecipe?: "pull-request" | "local-merge";
  adversarialReview?: boolean;
  maxTicketsInFlight?: string;
  maxTicketsInFlightError?: string;
} = {}) {
  return renderToStaticMarkup(
    <ProjectDeliverySettings
      deliveryRecipe={deliveryRecipe}
      onDeliveryRecipeChange={() => {}}
      adversarialReview={adversarialReview}
      onAdversarialReviewChange={() => {}}
      maxTicketsInFlight={maxTicketsInFlight}
      onMaxTicketsInFlightChange={() => {}}
      maxTicketsInFlightError={maxTicketsInFlightError}
    />,
  );
}

/** The `<p>` carrying `id="project-delivery-recipe-hint"`, whichever recipe produced it. */
function recipeHint(html: string): string {
  const at = html.indexOf('id="project-delivery-recipe-hint"');
  expect(at, "the recipe hint is rendered").toBeGreaterThan(-1);
  const start = html.lastIndexOf("<p", at);
  const end = html.indexOf("</p>", at) + "</p>".length;
  return html.slice(start, end);
}

describe("ProjectDeliverySettings", () => {
  it("renders the recipe select, described by its own hint", () => {
    const html = render();

    expect(html).toContain('data-testid="project-delivery-recipe"');
    expect(html).toContain('aria-describedby="project-delivery-recipe-hint"');
    expect(recipeHint(html)).toContain('id="project-delivery-recipe-hint"');
  });

  it("shows the pull-request recipe's own hint key, not the local-merge one", () => {
    const hint = recipeHint(render({ deliveryRecipe: "pull-request" }));

    expect(hint).toContain(`data-hint-key="${DELIVERY_RECIPE_HINT_KEY["pull-request"]}"`);
    expect(hint).not.toContain(`data-hint-key="${DELIVERY_RECIPE_HINT_KEY["local-merge"]}"`);
  });

  it("shows the local-merge recipe's own hint key, not the pull-request one", () => {
    const hint = recipeHint(render({ deliveryRecipe: "local-merge" }));

    expect(hint).toContain(`data-hint-key="${DELIVERY_RECIPE_HINT_KEY["local-merge"]}"`);
    expect(hint).not.toContain(`data-hint-key="${DELIVERY_RECIPE_HINT_KEY["pull-request"]}"`);
  });

  it("reflects the adversarial review switch's checked state", () => {
    const on = render({ adversarialReview: true });
    const off = render({ adversarialReview: false });

    expect(on).toContain('data-testid="project-adversarial-review"');
    expect(on).toContain('id="project-adversarial-review"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('data-state="checked"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('data-state="unchecked"');
  });

  it("labels the review switch for the field it controls", () => {
    const html = render();

    expect(html).toContain('for="project-adversarial-review"');
  });

  it("renders the tickets in flight field, labelled and described by its hint", () => {
    const html = render({ maxTicketsInFlight: "2" });

    expect(html).toContain('data-testid="project-max-tickets-in-flight"');
    expect(html).toContain('id="project-max-tickets-in-flight"');
    expect(html).toContain('for="project-max-tickets-in-flight"');
    expect(html).toContain('aria-describedby="project-max-tickets-in-flight-hint"');
    expect(html).toContain('id="project-max-tickets-in-flight-hint"');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
    expect(html).toContain('value="2"');
    expect(html).toContain('aria-invalid="false"');
  });

  it("shows the field's error in place of its hint, and marks the input invalid", () => {
    const html = render({ maxTicketsInFlightError: "Tickets in flight must be a whole number from 1 to 10." });

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Tickets in flight must be a whole number from 1 to 10.");
  });
});

describe("seedDeliverySettings", () => {
  it("defaults to pull-request with review on when there is no project", () => {
    expect(seedDeliverySettings(null)).toEqual({
      deliveryRecipe: "pull-request",
      adversarialReview: true,
      maxTicketsInFlight: 3,
    });
  });

  it("reads both fields from the project being edited", () => {
    expect(
      seedDeliverySettings({
        deliveryRecipe: "local-merge",
        adversarialReview: false,
        maxTicketsInFlight: 5,
      }),
    ).toEqual({ deliveryRecipe: "local-merge", adversarialReview: false, maxTicketsInFlight: 5 });

    expect(
      seedDeliverySettings({
        deliveryRecipe: "pull-request",
        adversarialReview: true,
        maxTicketsInFlight: 1,
      }),
    ).toEqual({ deliveryRecipe: "pull-request", adversarialReview: true, maxTicketsInFlight: 1 });
  });

  it("falls back to the defaults for a project missing either field", () => {
    expect(seedDeliverySettings({})).toEqual({
      deliveryRecipe: "pull-request",
      adversarialReview: true,
      maxTicketsInFlight: 3,
    });
    expect(
      seedDeliverySettings({ deliveryRecipe: null, adversarialReview: null, maxTicketsInFlight: null }),
    ).toEqual({
      deliveryRecipe: "pull-request",
      adversarialReview: true,
      maxTicketsInFlight: 3,
    });
  });
});

describe("withDeliverySettings", () => {
  it("folds both fields into the rest of the edit, for update-project's payload", () => {
    const fields = { name: "Grill Room", verifyCommand: "pnpm test" };

    expect(
      withDeliverySettings(fields, { deliveryRecipe: "local-merge", adversarialReview: false }),
    ).toEqual({
      name: "Grill Room",
      verifyCommand: "pnpm test",
      deliveryRecipe: "local-merge",
      adversarialReview: false,
    });
  });

  it("sends tickets in flight only when it is defined", () => {
    const fields = { name: "Grill Room" };

    const without = withDeliverySettings(fields, {
      deliveryRecipe: "pull-request",
      adversarialReview: true,
      maxTicketsInFlight: undefined,
    });
    expect(Object.keys(without)).not.toContain("maxTicketsInFlight");

    expect(
      withDeliverySettings(fields, {
        deliveryRecipe: "pull-request",
        adversarialReview: true,
        maxTicketsInFlight: 2,
      }),
    ).toEqual({
      name: "Grill Room",
      deliveryRecipe: "pull-request",
      adversarialReview: true,
      maxTicketsInFlight: 2,
    });
  });

  it("leaves the original fields object untouched", () => {
    const fields = { name: "Grill Room" };

    withDeliverySettings(fields, { deliveryRecipe: "pull-request", adversarialReview: true });

    expect(fields).toEqual({ name: "Grill Room" });
  });
});
