import { describe, expect, it } from "vitest";

import { buildPrompt } from "./interviewer/prompt.js";
import {
  MAX_SHARPENED_IDEA_LENGTH,
  MAX_SHARPENING_CARDS,
  resultSchemas,
  type SharpenCardsResult,
  type SharpeningDirection,
} from "./interviewer/schemas.js";
import {
  aDecision,
  aContext,
  aSharpenCardsRequest,
  aSharpeningCard,
  aSharpeningRound,
  aSharpenRewriteRequest,
  aSharpenRewriteResult,
} from "./interviewer/test-fixtures.js";
import type { SharpeningAnswerKind } from "./interviewer/types.js";
import {
  reasonsToRefuseSharpenCards,
  reasonsToRefuseSharpenRewrite,
} from "./sharpening.js";

const used = (key: string) =>
  `Card key "${key}" is already used by a decision or an earlier card. Choose a new key.`;
const repeated = (key: string) =>
  `Card key "${key}" is used twice in this round. Give each card its own key.`;
const firstRound = (missing: string) =>
  `The first round must ask at least one card for each of what, who and outcome; it has none for ${missing}.`;
const choice = (key: string, index: number) =>
  `Decision "${key}" sets \`recommendedChoice\` to ${index}, which is not one of its 2 choices. Use an index from 0 to 1, or null when the recommendation is none of them.`;

/** A card keyed after its direction, as rows 7-14f name them; `scope` and `shape` are constraints. */
function card(
  key: string,
  overrides: Partial<SharpenCardsResult["cards"][number]> = {},
) {
  const direction: SharpeningDirection =
    key === "what" || key === "who" || key === "outcome" ? key : "constraint";
  return aSharpeningCard(key, { direction, ...overrides });
}

function cardsOf(...cards: SharpenCardsResult["cards"]): SharpenCardsResult {
  return { cards };
}

describe("reasonsToRefuseSharpenCards", () => {
  it("row 7: a first round of outcome, who and what, in that order, passes", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("outcome"), card("who"), card("what")),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([]);
  });

  it("row 7b: the first-round check counts directions, not keys", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(
          card("a", { direction: "what" }),
          card("b", { direction: "who" }),
          card("c", { direction: "outcome" }),
        ),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([]);
  });

  it("row 7c: a card keyed who with direction constraint does not ask who", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("what"), card("outcome"), card("who", { direction: "constraint" })),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([firstRound("who")]);
  });

  it("row 8: a key repeated in the round is refused once", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("what"), card("what"), card("who"), card("outcome")),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([repeated("what")]);
  });

  it("row 8b: a key used three times gives two reasons", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("what"), card("what"), card("what"), card("who"), card("outcome")),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([repeated("what"), repeated("what")]);
  });

  it("row 9: a key the tree or an earlier card uses is refused", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("scope")), {
        usedKeys: ["repo-db", "scope"],
        firstRound: false,
      }),
    ).toEqual([used("scope")]);
  });

  it("row 10: a used key that also repeats is refused once, as used", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("scope"), card("scope")), {
        usedKeys: ["scope"],
        firstRound: false,
      }),
    ).toEqual([used("scope")]);
  });

  it("row 11: a recommended choice past the choices is refused", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("scope", { recommendedChoice: 5 })),
        { usedKeys: [], firstRound: false },
      ),
    ).toEqual([choice("scope", 5)]);
  });

  it("row 12: a first round without who and outcome is refused", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("what"), card("constraint")), {
        usedKeys: [],
        firstRound: true,
      }),
    ).toEqual([firstRound("who, outcome")]);
  });

  it("row 13: a later round needs no particular direction", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("constraint")), {
        usedKeys: [],
        firstRound: false,
      }),
    ).toEqual([]);
  });

  it("row 14: a card with a key reason still counts for the first-round check", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("who"), card("what"), card("outcome", { recommendedChoice: 5 })),
        { usedKeys: ["who"], firstRound: true },
      ),
    ).toEqual([used("who"), choice("outcome", 5)]);
  });

  it("row 14b: every key reason comes before every choice reason", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("scope", { recommendedChoice: 5 }), card("shape")),
        { usedKeys: ["shape"], firstRound: false },
      ),
    ).toEqual([used("shape"), choice("scope", 5)]);
  });

  it("row 14c: the first-round reason comes after the choice reasons", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(card("what"), card("constraint", { recommendedChoice: 5 })),
        { usedKeys: [], firstRound: true },
      ),
    ).toEqual([choice("constraint", 5), firstRound("who, outcome")]);
  });

  it("row 14d: key reasons follow card order, used then repeated", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("b"), card("a"), card("b")), {
        usedKeys: ["a"],
        firstRound: false,
      }),
    ).toEqual([used("a"), repeated("b")]);
  });

  it("row 14f: key reasons follow card order, repeated then used", () => {
    expect(
      reasonsToRefuseSharpenCards(cardsOf(card("b"), card("b"), card("a")), {
        usedKeys: ["a"],
        firstRound: false,
      }),
    ).toEqual([repeated("b"), used("a")]);
  });

  it("row 14e: choice reasons follow card order", () => {
    expect(
      reasonsToRefuseSharpenCards(
        cardsOf(
          card("shape", { recommendedChoice: 7 }),
          card("scope", { recommendedChoice: 5 }),
        ),
        { usedKeys: [], firstRound: false },
      ),
    ).toEqual([choice("shape", 7), choice("scope", 5)]);
  });
});

const CURRENT_IDEA = "Decide how to evaluate eight repos.";
const ANSWERS: { key: string; kind: SharpeningAnswerKind }[] = [
  { key: "what", kind: "accepted-recommendation" },
  { key: "who", kind: "unknown" },
  { key: "outcome", kind: "own-answer" },
];

const lengthReason = (n: number) =>
  `The rewritten idea is ${n} characters; it may be at most 2000.`;
const SAME_IDEA =
  "The rewritten idea is the current idea. Rewrite it from this round's answers.";
const missingUse = (key: string) =>
  `The rewrite does not say how it uses the answer to "${key}".`;
const repeatedUse = (key: string) =>
  `The rewrite names "${key}" more than once in uses.`;
const unknownUse = (key: string) =>
  `"${key}" was answered "I don't know"; leave it out of uses.`;
const foreignUse = (key: string) => `"${key}" is not a card of this round.`;

function rewriteOf(idea: string, ...keys: string[]) {
  return aSharpenRewriteResult({
    idea,
    uses: keys.map((cardKey) => ({ cardKey, how: `Uses ${cardKey}.` })),
  });
}

function refuseRewrite(idea: string, ...keys: string[]): string[] {
  return reasonsToRefuseSharpenRewrite(rewriteOf(idea, ...keys), {
    currentIdea: CURRENT_IDEA,
    answers: ANSWERS,
  });
}

const NEW_IDEA = "A tracker for my club's training plans.";

/** A text of `length` characters with no surrounding space, ending in a full stop, with one double space inside. */
function ideaOfLength(length: number): string {
  const body = "a  " + "b".repeat(length - 4);
  return `${body}.`;
}

describe("reasonsToRefuseSharpenRewrite", () => {
  it("row 15: a rewrite using every settling answer passes", () => {
    expect(refuseRewrite(NEW_IDEA, "what", "outcome")).toEqual([]);
  });

  it("row 16: uses may come in any order", () => {
    expect(refuseRewrite(NEW_IDEA, "outcome", "what")).toEqual([]);
  });

  it("row 17: an idea of 2001 characters after trim is refused", () => {
    expect(refuseRewrite("x".repeat(2001), "what", "outcome")).toEqual([
      lengthReason(2001),
    ]);
  });

  it("row 17b: 2000 characters after trim, 2002 in all, passes", () => {
    const idea = ` ${"x".repeat(2000)} `;
    expect(idea.length).toBe(2002);
    expect(refuseRewrite(idea, "what", "outcome")).toEqual([]);
  });

  it("row 17c: the length is the trimmed one, not the normalized one", () => {
    const inner = ideaOfLength(2001);
    expect(inner.length).toBe(2001);
    const idea = ` ${inner} `;
    expect(idea.length).toBe(2003);
    expect(refuseRewrite(idea, "what", "outcome")).toEqual([lengthReason(2001)]);
  });

  it("row 17d: a too-long idea equal to the current one gets both reasons", () => {
    const idea = "y".repeat(2100);
    expect(
      reasonsToRefuseSharpenRewrite(rewriteOf(idea, "what", "outcome"), {
        currentIdea: idea,
        answers: ANSWERS,
      }),
    ).toEqual([lengthReason(2100), SAME_IDEA]);
  });

  it("row 18: the same idea up to case, spaces and full stop is refused", () => {
    expect(
      refuseRewrite("  decide how to evaluate eight repos  ", "what", "outcome"),
    ).toEqual([SAME_IDEA]);
  });

  it("row 19: a settling answer left out of uses is refused", () => {
    expect(refuseRewrite(NEW_IDEA, "what")).toEqual([missingUse("outcome")]);
  });

  it("row 20: a key named twice in uses is refused", () => {
    expect(refuseRewrite(NEW_IDEA, "what", "outcome", "what")).toEqual([
      repeatedUse("what"),
    ]);
  });

  it("row 21: an I don't know answer in uses is refused", () => {
    expect(refuseRewrite(NEW_IDEA, "what", "outcome", "who")).toEqual([
      unknownUse("who"),
    ]);
  });

  it("row 22: a key that is no card of this round is refused", () => {
    expect(refuseRewrite(NEW_IDEA, "what", "outcome", "shape")).toEqual([
      foreignUse("shape"),
    ]);
  });

  it("row 23: every reason is given, not only the first", () => {
    expect(refuseRewrite(CURRENT_IDEA, "shape")).toEqual([
      SAME_IDEA,
      missingUse("what"),
      missingUse("outcome"),
      foreignUse("shape"),
    ]);
  });

  it("row 23b: an empty uses is refused for every settling answer", () => {
    expect(refuseRewrite(NEW_IDEA)).toEqual([
      missingUse("what"),
      missingUse("outcome"),
    ]);
  });

  it("row 23c: the groups come in order, foreign keys in the order of first use", () => {
    expect(
      refuseRewrite(NEW_IDEA, "what", "what", "who", "shape", "who", "scope"),
    ).toEqual([
      missingUse("outcome"),
      repeatedUse("what"),
      repeatedUse("who"),
      unknownUse("who"),
      foreignUse("shape"),
      foreignUse("scope"),
    ]);
  });

  it("row 23d: one reason per repeated use, in the order the uses come", () => {
    expect(
      refuseRewrite(NEW_IDEA, "who", "outcome", "what", "who", "what", "what"),
    ).toEqual([
      repeatedUse("who"),
      repeatedUse("what"),
      repeatedUse("what"),
      unknownUse("who"),
    ]);
  });

  it("reasons 5 and 6 name each key once, in the order of first use", () => {
    const answers: { key: string; kind: SharpeningAnswerKind }[] = [
      { key: "what", kind: "accepted-recommendation" },
      { key: "who", kind: "unknown" },
      { key: "budget", kind: "unknown" },
      { key: "cost", kind: "unknown" },
    ];
    expect(
      reasonsToRefuseSharpenRewrite(
        rewriteOf(
          NEW_IDEA,
          "what",
          "cost",
          "zeta",
          "who",
          "budget",
          "cost",
          "alpha",
          "zeta",
          "who",
        ),
        { currentIdea: CURRENT_IDEA, answers },
      ),
    ).toEqual([
      repeatedUse("cost"),
      repeatedUse("zeta"),
      repeatedUse("who"),
      unknownUse("cost"),
      unknownUse("who"),
      unknownUse("budget"),
      foreignUse("zeta"),
      foreignUse("alpha"),
    ]);
  });
});

/** The single line of `prompt` that starts with `prefix`, or a failure naming it. */
function lineStarting(prompt: string, prefix: string): string {
  const lines = prompt.split("\n").filter((line) => line.startsWith(prefix));
  expect(lines, `one line starting "${prefix}"`).toHaveLength(1);
  return lines[0]!;
}

describe("the sharpening prompts and their checks", () => {
  it("every card shape the cards prompt describes passes the check", () => {
    // A later round whose used keys hold the tree's key and an earlier card's.
    const laterRequest = aSharpenCardsRequest({
      context: aContext({
        idea: "Build a scoring sheet to compare eight repos.",
        decisions: [aDecision({ key: "repo-db", state: "settled" })],
      }),
      rounds: [aSharpeningRound()],
      usedKeys: ["repo-db", "sharpen-what", "sharpen-who"],
    });
    const firstRequest = aSharpenCardsRequest();

    const laterPrompt = buildPrompt(laterRequest);
    const firstPrompt = buildPrompt(firstRequest);

    const range = /^Return between 1 and (\d+) cards\.$/.exec(
      lineStarting(laterPrompt, "Return between 1 and "),
    );
    expect(range).not.toBeNull();
    const max = Number(range![1]);
    expect(max).toBe(MAX_SHARPENING_CARDS);

    const keyLine = /^Give each card its own key, and use none of these: (.+)\.$/.exec(
      lineStarting(laterPrompt, "Give each card its own key"),
    );
    expect(keyLine).not.toBeNull();
    const promptKeys = keyLine![1]!.split(", ");
    expect(promptKeys).toEqual(laterRequest.usedKeys);

    const directionsLine =
      /^In the first round, ask at least one card for each of these directions: (.+)\.$/.exec(
        lineStarting(firstPrompt, "In the first round, ask"),
      );
    expect(directionsLine).not.toBeNull();
    const directions = directionsLine![1]!.split(", ") as SharpeningDirection[];

    const passes = (
      cards: SharpenCardsResult["cards"],
      options: { usedKeys: string[]; firstRound: boolean },
    ) => {
      expect(resultSchemas["sharpen-cards"].safeParse({ cards }).success).toBe(true);
      expect(reasonsToRefuseSharpenCards({ cards }, options)).toEqual([]);
    };
    const first = { usedKeys: firstRequest.usedKeys, firstRound: true };
    const later = { usedKeys: promptKeys, firstRound: false };

    // The smallest first round the directions line describes.
    passes(
      directions.map((direction, index) =>
        aSharpeningCard(`card-${index + 1}`, { direction }),
      ),
      first,
    );
    // A first round of three cards, one per direction.
    passes(
      [
        aSharpeningCard("s-what", { direction: "what" }),
        aSharpeningCard("s-who", { direction: "who" }),
        aSharpeningCard("s-outcome", { direction: "outcome" }),
      ],
      first,
    );
    // A first round of four cards with a constraint.
    passes(
      [
        aSharpeningCard("s-what", { direction: "what" }),
        aSharpeningCard("s-who", { direction: "who" }),
        aSharpeningCard("s-outcome", { direction: "outcome" }),
        aSharpeningCard("s-limit", { direction: "constraint" }),
      ],
      first,
    );
    // A later round of one card.
    passes([aSharpeningCard("s-scope")], later);
    // A later round with a card that has no choices.
    passes(
      [aSharpeningCard("s-open", { choices: [], recommendedChoice: null })],
      later,
    );
    // A round of the most cards the range line allows; one more fails the schema.
    const most = Array.from({ length: max }, (_, index) =>
      aSharpeningCard(`s-${index + 1}`),
    );
    passes(most, later);
    expect(
      resultSchemas["sharpen-cards"].safeParse({
        cards: [...most, aSharpeningCard("s-extra")],
      }).success,
    ).toBe(false);
  });

  it("every rewrite shape the rewrite prompt describes passes the check", () => {
    const keysIn = (prompt: string) => {
      const match = /^Name each of these keys exactly once in uses: (.*)\.$/.exec(
        lineStarting(prompt, "Name each of these keys exactly once in uses:"),
      );
      expect(match).not.toBeNull();
      return match![1]!.split(", ");
    };
    const lengthLine = (prompt: string) => {
      const match = /^The idea must be at most (\d+) characters\.$/.exec(
        lineStarting(prompt, "The idea must be at most "),
      );
      expect(match).not.toBeNull();
      return Number(match![1]);
    };

    const allSettling = aSharpenRewriteRequest({
      answers: [
        { key: "what", title: "What gets built?", kind: "accepted-recommendation", text: "A tracker" },
        { key: "outcome", title: "What exists?", kind: "own-answer", text: "Plans followed" },
      ],
    });
    const oneUnknown = aSharpenRewriteRequest();

    for (const request of [allSettling, oneUnknown]) {
      const prompt = buildPrompt(request);
      const uses = keysIn(prompt).map((cardKey) => ({
        cardKey,
        how: `Uses ${cardKey}.`,
      }));
      const options = {
        currentIdea: request.context.idea,
        answers: request.answers,
      };
      expect(
        reasonsToRefuseSharpenRewrite(
          aSharpenRewriteResult({ idea: NEW_IDEA, uses }),
          options,
        ),
      ).toEqual([]);

      const max = lengthLine(prompt);
      expect(max).toBe(MAX_SHARPENED_IDEA_LENGTH);
      expect(
        reasonsToRefuseSharpenRewrite(
          aSharpenRewriteResult({ idea: "z".repeat(max), uses }),
          options,
        ),
      ).toEqual([]);
      expect(
        reasonsToRefuseSharpenRewrite(
          aSharpenRewriteResult({ idea: "z".repeat(max + 1), uses }),
          options,
        ),
      ).toEqual([lengthReason(max + 1)]);
    }
  });
});
