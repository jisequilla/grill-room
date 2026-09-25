import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectDeliverySettings } from "@/components/projects/project-delivery-settings";

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
}: { deliveryRecipe?: "pull-request" | "local-merge"; adversarialReview?: boolean } = {}) {
  return renderToStaticMarkup(
    <ProjectDeliverySettings
      deliveryRecipe={deliveryRecipe}
      onDeliveryRecipeChange={() => {}}
      adversarialReview={adversarialReview}
      onAdversarialReviewChange={() => {}}
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

  it("gives each recipe its own hint, not a shared one", () => {
    const pullRequest = recipeHint(render({ deliveryRecipe: "pull-request" }));
    const localMerge = recipeHint(render({ deliveryRecipe: "local-merge" }));

    expect(pullRequest).not.toBe(localMerge);
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
});
