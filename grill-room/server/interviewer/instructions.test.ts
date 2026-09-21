import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_ADDENDUM,
  GRILLING_SKILL_FILE,
  interviewerInstructions,
  loadGrillingSkill,
  loadSpecTemplate,
} from "./instructions.js";
import { buildPrompt } from "./prompt.js";
import {
  aProposeRoundRequest,
  aSynthesizeSpecRequest,
} from "./test-fixtures.js";

/** The upstream skills, as installed at the repository root. */
const REPO_GRILLING_SKILL = fileURLToPath(
  new URL("../../../.claude/skills/grilling/SKILL.md", import.meta.url),
);
const REPO_TO_SPEC_SKILL = fileURLToPath(
  new URL("../../../.claude/skills/to-spec/SKILL.md", import.meta.url),
);

describe("the installed instruction copies", () => {
  it("keeps the grilling skill byte-identical to the repository's own", () => {
    expect(readFileSync(GRILLING_SKILL_FILE)).toEqual(
      readFileSync(REPO_GRILLING_SKILL),
    );
  });

  it("keeps the spec template byte-identical to the to-spec skill's block", () => {
    const upstream = readFileSync(REPO_TO_SPEC_SKILL, "utf8");
    const start = upstream.indexOf("<spec-template>");
    const end = upstream.indexOf("</spec-template>") + "</spec-template>".length;

    expect(start).toBeGreaterThan(-1);
    expect(loadSpecTemplate().trimEnd()).toBe(upstream.slice(start, end));
  });
});

describe("the interviewer's instructions", () => {
  it("carries the skill text verbatim, then the app addendum", () => {
    const instructions = interviewerInstructions();

    expect(instructions).toContain(loadGrillingSkill().trimEnd());
    expect(instructions).toContain(APP_ADDENDUM);
    expect(instructions.indexOf(APP_ADDENDUM)).toBeGreaterThan(
      instructions.indexOf("design tree"),
    );
  });

  it("tells the interviewer the four things the skill cannot know", () => {
    expect(APP_ADDENDUM).toContain("structured");
    expect(APP_ADDENDUM).toContain("Fact-finding is unavailable");
    expect(APP_ADDENDUM).toContain("dependsOn");
    expect(APP_ADDENDUM).toContain("still open");
  });
});

describe("the prompt for a turn", () => {
  it("opens with the full instructions and states the idea and the tree", () => {
    const prompt = buildPrompt(
      aProposeRoundRequest({
        context: {
          ...aProposeRoundRequest().context,
          idea: "An app that grills me",
          decisions: [
            {
              key: "shape",
              title: "What shape?",
              body: "Body.",
              choices: ["a", "b"],
              recommendedAnswer: "b",
              dependsOn: [],
              state: "settled",
              answer: { kind: "own-answer", text: "b, but narrower" },
              previousAnswers: [],
              introducedBy: "interviewer",
            },
          ],
        },
      }),
    );

    expect(prompt).toContain(loadGrillingSkill().trimEnd());
    expect(prompt).toContain("An app that grills me");
    expect(prompt).toContain("[shape] (settled, added by interviewer)");
    expect(prompt).toContain("answer (own-answer): b, but narrower");
    expect(prompt).toContain("propose the next round");
  });

  it("never starts with a dash, which the command line reads as an option", () => {
    // The grilling skill opens with `---`. A prompt that begins with it is
    // rejected as an unknown option before the turn starts.
    for (const request of [aProposeRoundRequest(), aSynthesizeSpecRequest()]) {
      expect(buildPrompt(request).startsWith("-")).toBe(false);
      expect(buildPrompt(request, { primed: true }).startsWith("-")).toBe(false);
    }
  });

  it("explains itself when the conversation had to be restarted", () => {
    const request = aProposeRoundRequest();

    expect(buildPrompt(request, { primed: true })).toContain(
      "could not be resumed",
    );
    expect(buildPrompt(request)).not.toContain("could not be resumed");
  });

  it("carries the spec template verbatim when synthesizing a spec", () => {
    const prompt = buildPrompt(
      aSynthesizeSpecRequest({
        outOfScope: ["Multiple users"],
        openQuestions: ["Which export layout wins"],
      }),
    );

    expect(prompt).toContain(loadSpecTemplate().trimEnd());
    expect(prompt).toContain("Multiple users");
    expect(prompt).toContain("Which export layout wins");
  });

  it("passes the app's rejection reason back to the interviewer", () => {
    const prompt = buildPrompt(
      aProposeRoundRequest({
        rejectionReason: "q3 depends on q2, which is still open.",
      }),
    );

    expect(prompt).toContain("q3 depends on q2, which is still open.");
  });
});
