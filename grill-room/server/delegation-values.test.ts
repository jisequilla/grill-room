import { describe, expect, it } from "vitest";

import { NO_DELEGATION_PROPOSALS } from "./interviewer/test-fixtures.js";
import {
  parseDelegationProposals,
  pendingDelegationProposals,
  type DelegationProposals,
  type DelegationValues,
  parseDelegationValues,
  serializeDelegationProposals,
  serializeDelegationValues,
} from "./delegation-values.js";

const prune = (command: string, citation: string) =>
  JSON.stringify({ pruneCommand: { command, citation } });
const review = (citation: string) => JSON.stringify({ reviewRule: { citation } });

describe("parseDelegationValues", () => {
  it("reads null as no slot", () => {
    expect(parseDelegationValues(null)).toEqual({});
  });

  it("reads a prune command", () => {
    const text = prune("just prune-worktrees", ".claude/rules/worktrees.md:86");
    expect(parseDelegationValues(text)).toEqual(JSON.parse(text));
  });

  it("throws on a blank command", () => {
    expect(() => parseDelegationValues(prune("  ", "a.md:1"))).toThrow();
  });

  it("throws on a citation with no line", () => {
    expect(() => parseDelegationValues(review("a.md"))).toThrow();
  });

  it("accepts a citation by format alone, not by whether the file exists", () => {
    expect(parseDelegationValues(review("/a.md:3"))).toEqual({ reviewRule: { citation: "/a.md:3" } });
  });

  it("throws on an unknown slot", () => {
    expect(() => parseDelegationValues('{"colour":{}}')).toThrow();
  });

  it("throws on an unknown key inside a slot", () => {
    expect(() =>
      parseDelegationValues('{"pruneCommand":{"command":"a","citation":"a.md:1","x":1}}'),
    ).toThrow();
  });

  it("trims the command", () => {
    expect(parseDelegationValues(prune(" just x ", "a.md:1"))).toEqual({
      pruneCommand: { command: "just x", citation: "a.md:1" },
    });
  });

  it("throws on line 0", () => {
    expect(() => parseDelegationValues(review("a.md:0"))).toThrow();
  });

  it("throws on an end line below the start, and accepts an equal one", () => {
    expect(() => parseDelegationValues(review("a.md:5-3"))).toThrow();
    expect(parseDelegationValues(review("a.md:5-5"))).toEqual({ reviewRule: { citation: "a.md:5-5" } });
  });

  it("throws on a confirmed cap that carries a value", () => {
    expect(() =>
      parseDelegationValues('{"maxTicketsInFlight":{"value":3,"citation":"a.md:1"}}'),
    ).toThrow();
  });

  it("throws on text that is not JSON", () => {
    expect(() => parseDelegationValues("not json")).toThrow();
    expect(() => parseDelegationValues("")).toThrow();
  });

  it("reads an empty object", () => {
    expect(parseDelegationValues("{}")).toEqual({});
  });

  it("throws on a null slot", () => {
    expect(() => parseDelegationValues('{"pruneCommand":null}')).toThrow();
  });

  it("throws on JSON that is not an object", () => {
    expect(() => parseDelegationValues("[]")).toThrow();
    expect(() => parseDelegationValues("null")).toThrow();
    expect(() => parseDelegationValues('"x"')).toThrow();
  });

  it("checks the regex and the line rules, nothing more", () => {
    expect(parseDelegationValues(review("../x.md:1"))).toEqual({ reviewRule: { citation: "../x.md:1" } });
    expect(parseDelegationValues(review("a b.md:1"))).toEqual({ reviewRule: { citation: "a b.md:1" } });
  });
});

describe("parseDelegationProposals", () => {
  it("reads a proposed cap with its value", () => {
    const text = '{"maxTicketsInFlight":{"value":3,"citation":".claude/rules/worktrees.md:44-44"}}';
    expect(parseDelegationProposals(text)).toEqual(JSON.parse(text));
  });

  it("throws on a cap outside 1 to 10", () => {
    expect(() =>
      parseDelegationProposals('{"maxTicketsInFlight":{"value":11,"citation":"a.md:1"}}'),
    ).toThrow();
  });

  it("throws on a proposed cap without its value", () => {
    expect(() => parseDelegationProposals('{"maxTicketsInFlight":{"citation":"a.md:1"}}')).toThrow();
  });

  it("throws on an unknown slot", () => {
    expect(() => parseDelegationProposals('{"colour":{}}')).toThrow();
  });

  it("throws on an unknown key inside a slot, for the cap and the prune command", () => {
    expect(() =>
      parseDelegationProposals('{"maxTicketsInFlight":{"value":3,"citation":"a.md:1","x":1}}'),
    ).toThrow();
    expect(() =>
      parseDelegationProposals('{"pruneCommand":{"command":"a","citation":"a.md:1","x":1}}'),
    ).toThrow();
  });

  it("throws on a cap that is not a whole number from 1 to 10", () => {
    for (const value of [0, 2.5]) {
      expect(() =>
        parseDelegationProposals(
          JSON.stringify({ maxTicketsInFlight: { value, citation: "a.md:1" } }),
        ),
      ).toThrow();
    }
  });

  it("throws on a blank command, and on a citation with no line, in a proposal", () => {
    expect(() => parseDelegationProposals(prune("  ", "a.md:1"))).toThrow();
    expect(() => parseDelegationProposals(review("a.md"))).toThrow();
    expect(() =>
      parseDelegationProposals('{"maxTicketsInFlight":{"value":3,"citation":"a.md"}}'),
    ).toThrow();
  });

  it("mirrors the values helpers on null and empty", () => {
    expect(parseDelegationProposals(null)).toEqual({});
    expect(serializeDelegationProposals({})).toBeNull();
  });
});

describe("serializeDelegationValues", () => {
  it("stores no slot as null", () => {
    expect(serializeDelegationValues({})).toBeNull();
    expect(serializeDelegationValues({ pruneCommand: undefined })).toBeNull();
  });

  it("runs the schema: trims, and throws on what parse refuses", () => {
    expect(
      serializeDelegationValues({ pruneCommand: { command: " x ", citation: "a.md:1" } }),
    ).toBe('{"pruneCommand":{"command":"x","citation":"a.md:1"}}');
    expect(() =>
      serializeDelegationValues({ pruneCommand: { command: " ", citation: "a.md:1" } }),
    ).toThrow();
  });

  it("round-trips through parse", () => {
    const values = {
      maxTicketsInFlight: { citation: "a.md:1" },
      pruneCommand: { command: "just x", citation: "a.md:2-4" },
      reviewRule: { citation: "b.md:7" },
      preflight: { citation: "c.md:9" },
    };
    expect(parseDelegationValues(serializeDelegationValues(values))).toEqual(values);
  });
});

describe("pendingDelegationProposals", () => {
  const proposedPrune = { command: "just prune", citation: "CLAUDE.md:4" };
  const proposedCap = { value: 2, citation: "CLAUDE.md:7" };

  function pending(input: {
    proposed?: Partial<typeof NO_DELEGATION_PROPOSALS>;
    values?: DelegationValues;
    dismissed?: DelegationProposals;
    cap?: number;
  }) {
    return pendingDelegationProposals({
      proposed: { ...NO_DELEGATION_PROPOSALS, ...input.proposed },
      values: input.values ?? {},
      dismissed: input.dismissed ?? {},
      maxTicketsInFlight: input.cap ?? 3,
    });
  }

  it("lists a prune proposal nothing confirmed or dismissed", () => {
    expect(pending({ proposed: { pruneCommand: proposedPrune } })).toEqual([
      { slot: "pruneCommand", proposal: proposedPrune, confirmed: null },
    ]);
  });

  it("drops a prune proposal whose command is already confirmed, whatever the citation", () => {
    expect(
      pending({
        proposed: { pruneCommand: proposedPrune },
        values: { pruneCommand: { command: "just prune", citation: "CLAUDE.md:9" } },
      }),
    ).toEqual([]);
  });

  it("lists a prune proposal that differs from the confirmed command, with the confirmed value", () => {
    expect(
      pending({
        proposed: { pruneCommand: proposedPrune },
        values: { pruneCommand: { command: "make prune", citation: "CLAUDE.md:9" } },
      }),
    ).toEqual([
      {
        slot: "pruneCommand",
        proposal: proposedPrune,
        confirmed: { command: "make prune", citation: "CLAUDE.md:9" },
      },
    ]);
  });

  it("drops a prune proposal the owner dismissed", () => {
    expect(
      pending({ proposed: { pruneCommand: proposedPrune }, dismissed: { pruneCommand: proposedPrune } }),
    ).toEqual([]);
  });

  it("lists a prune proposal again when the dismissal was for another line", () => {
    expect(
      pending({
        proposed: { pruneCommand: proposedPrune },
        dismissed: { pruneCommand: { command: "just prune", citation: "CLAUDE.md:5" } },
      }),
    ).toEqual([{ slot: "pruneCommand", proposal: proposedPrune, confirmed: null }]);
  });

  it("drops a cap proposal equal to the confirmed cap", () => {
    expect(
      pending({
        proposed: { maxTicketsInFlight: proposedCap },
        values: { maxTicketsInFlight: { citation: "CLAUDE.md:7" } },
        cap: 2,
      }),
    ).toEqual([]);
  });

  it("lists a cap proposal the cap matches but was never confirmed from the repository", () => {
    expect(pending({ proposed: { maxTicketsInFlight: proposedCap }, cap: 2 })).toEqual([
      { slot: "maxTicketsInFlight", proposal: proposedCap, confirmed: null },
    ]);
  });

  it("lists a cap proposal the confirmed cap has since been edited away from", () => {
    expect(
      pending({
        proposed: { maxTicketsInFlight: proposedCap },
        values: { maxTicketsInFlight: { citation: "CLAUDE.md:7" } },
        cap: 5,
      }),
    ).toEqual([
      {
        slot: "maxTicketsInFlight",
        proposal: proposedCap,
        confirmed: { value: 5, citation: "CLAUDE.md:7" },
      },
    ]);
  });

  it("drops a review rule with the confirmed citation", () => {
    expect(
      pending({
        proposed: { reviewRule: { citation: "CLAUDE.md:3" } },
        values: { reviewRule: { citation: "CLAUDE.md:3" } },
      }),
    ).toEqual([]);
  });

  it("lists a pre-flight proposal whose citation differs from the confirmed one", () => {
    expect(
      pending({
        proposed: { preflight: { citation: "CLAUDE.md:8" } },
        values: { preflight: { citation: "CLAUDE.md:3" } },
      }),
    ).toEqual([
      {
        slot: "preflight",
        proposal: { citation: "CLAUDE.md:8" },
        confirmed: { citation: "CLAUDE.md:3" },
      },
    ]);
  });

  it("lists every slot in the order cap, prune, review rule, pre-flight", () => {
    expect(
      pending({
        proposed: {
          preflight: { citation: "CLAUDE.md:1" },
          reviewRule: { citation: "CLAUDE.md:2" },
          pruneCommand: proposedPrune,
          maxTicketsInFlight: proposedCap,
        },
      }).map((entry) => entry.slot),
    ).toEqual(["maxTicketsInFlight", "pruneCommand", "reviewRule", "preflight"]);
  });

  it("lists nothing when all four proposals are null", () => {
    expect(pending({ values: { reviewRule: { citation: "CLAUDE.md:3" } }, dismissed: { preflight: { citation: "a.md:1" } } })).toEqual([]);
  });

  it("lists nothing when the grounding has no proposals", () => {
    expect(
      pendingDelegationProposals({ proposed: undefined, values: {}, dismissed: {}, maxTicketsInFlight: 3 }),
    ).toEqual([]);
  });
});
