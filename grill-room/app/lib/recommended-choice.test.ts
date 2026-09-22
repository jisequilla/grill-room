import { describe, expect, it } from "vitest";

import {
  recommendedChoiceIndex,
  resolveRecommendedChoice,
} from "@/lib/recommended-choice";

describe("recommendedChoiceIndex", () => {
  it("matches a lettered choice the recommendation repeats verbatim", () => {
    expect(
      recommendedChoiceIndex(
        "A) Common photo formats only: .jpg/.jpeg/.png/.heic",
        [
          "A) Common photo formats only: .jpg/.jpeg/.png/.heic",
          "B) Above plus RAW formats (.cr2/.nef/.arw/.dng)",
          "C) Above plus video (.mp4/.mov)",
        ],
      ),
    ).toBe(0);
  });

  it("matches a later choice the recommendation repeats verbatim", () => {
    expect(
      recommendedChoiceIndex(
        "Backend + database (e.g. SQLite), accessible from any device/browser",
        [
          "Browser-only storage (localStorage/IndexedDB, no backend)",
          "Backend + database (e.g. SQLite), accessible from any device/browser",
        ],
      ),
    ).toBe(1);
  });

  it("does not mistake a sentence's colon for an enumeration label", () => {
    expect(
      recommendedChoiceIndex("Three states: Want to Read, Reading, Finished", [
        "Two states: Want to Read, Finished",
        "Three states: Want to Read, Reading, Finished",
      ]),
    ).toBe(1);
  });

  it("marks nothing when the recommendation names no choice", () => {
    expect(
      recommendedChoiceIndex(
        "Hooks for tool-call events plus the OTel exporter for token/cost metrics, since each covers what the other misses",
        [
          "Hooks only",
          "Transcript tailing only",
          "OTel exporter only",
          "Hooks + OTel combined",
        ],
      ),
    ).toBeNull();
  });

  it("matches a choice the recommendation elaborates on", () => {
    expect(
      recommendedChoiceIndex("On disk, in the app's own database", [
        "In memory",
        "On disk",
      ]),
    ).toBe(1);
  });

  it("matches on the leading label alone when the prose differs", () => {
    expect(
      recommendedChoiceIndex("B. RAW formats too, for the camera imports", [
        "A) Common photo formats only",
        "B) Above plus RAW formats",
      ]),
    ).toBe(1);
  });

  it("accepts an `Option A` label", () => {
    expect(
      recommendedChoiceIndex("Option B, because it is reversible", [
        "Option A — ship it behind a flag",
        "Option B — ship it to everyone",
      ]),
    ).toBe(1);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(
      recommendedChoiceIndex("  ON DISK  ", ["In memory", "On disk"]),
    ).toBe(1);
  });

  it("takes the first choice when more than one matches", () => {
    expect(
      recommendedChoiceIndex("On disk, in the app's own database", [
        "On disk",
        "On disk",
      ]),
    ).toBe(0);
  });

  it("marks nothing when the recommendation is absent", () => {
    expect(recommendedChoiceIndex(null, ["In memory", "On disk"])).toBeNull();
    expect(recommendedChoiceIndex("   ", ["In memory", "On disk"])).toBeNull();
  });

  it("marks nothing when no choices were offered", () => {
    expect(recommendedChoiceIndex("On disk", [])).toBeNull();
  });

  it("skips an empty choice rather than matching everything against it", () => {
    expect(recommendedChoiceIndex("On disk", ["", "On disk"])).toBe(1);
  });

  it("does not match an unlabelled recommendation to a labelled choice", () => {
    expect(
      recommendedChoiceIndex("Something else entirely", [
        "A) Common photo formats only",
        "B) Above plus RAW formats",
      ]),
    ).toBeNull();
  });
});

describe("resolveRecommendedChoice", () => {
  const reasoned = [
    { label: "pgx + sqlc", rationale: "Generated, typed, and one more build step." },
    { label: "Raw pgx", rationale: "No codegen, and every query is hand-checked." },
  ];

  it("takes the interviewer's index, even when the prose matches nothing", () => {
    expect(
      resolveRecommendedChoice({
        choices: reasoned,
        recommendedChoice: 0,
        recommendedAnswer:
          "pgx with sqlc on top, so the query layer is checked at build time rather than in review.",
      }),
    ).toBe(0);
  });

  it("does not guess past a null index on a decision whose choices are reasoned", () => {
    // The interviewer was asked for the index and told to answer null when its
    // recommendation is none of the choices. Falling back here would put the
    // marker back on a chip the interviewer declined to pick.
    expect(
      resolveRecommendedChoice({
        choices: reasoned,
        recommendedChoice: null,
        recommendedAnswer: "Raw pgx for now, and revisit once the schema settles.",
      }),
    ).toBeNull();
  });

  it("falls back to the prose match for a row stored before rationales existed", () => {
    expect(
      resolveRecommendedChoice({
        choices: [
          { label: "In memory", rationale: "" },
          { label: "On disk", rationale: "" },
        ],
        recommendedChoice: null,
        recommendedAnswer: "On disk, in the app's own database",
      }),
    ).toBe(1);
  });

  it("marks nothing when an old row's prose matches none of its choices", () => {
    expect(
      resolveRecommendedChoice({
        choices: [
          { label: "Hooks only", rationale: "" },
          { label: "OTel exporter only", rationale: "" },
        ],
        recommendedChoice: null,
        recommendedAnswer:
          "Hooks for tool-call events plus the OTel exporter for token metrics",
      }),
    ).toBeNull();
  });

  it("marks nothing when the stored index points past the choices", () => {
    expect(
      resolveRecommendedChoice({
        choices: reasoned,
        recommendedChoice: 7,
        recommendedAnswer: "pgx + sqlc",
      }),
    ).toBeNull();
  });
});
